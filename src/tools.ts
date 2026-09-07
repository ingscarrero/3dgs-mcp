/**
 * Tool definitions and handlers.
 *
 * `TOOLS` is what Claude sees in `tools/list`; `handleToolCall` is the
 * dispatcher behind `tools/call`. Handlers never throw: validation errors
 * and studio errors become `{ isError: true }` results so Claude can read
 * the message and recover.
 */
import { spawn } from 'child_process';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './config.js';
import { listProjectIds, listSplatFiles, readMeta, readRun } from './projects.js';
import { StudioError, studioDelete, studioPost } from './studio.js';
import {
  TRAINING_METHODS,
  ValidationError,
  assertArgsObject,
  buildStudioUrl,
  validateBoolean,
  validateDescription,
  validateId,
  validateMaxSteps,
  validateMethod,
  validateName,
  validateStudioPath,
  validateTags,
} from './validate.js';

/** Every handler returns a single text block; `isError` marks recoverable failures. */
export type ToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** Launches a URL in the user's default browser. Injected so tests can stub it. */
export type BrowserOpener = (url: string) => void;

export interface ToolDeps {
  openBrowser: BrowserOpener;
}

export const RECENT_LOG_LINES = 20;
export const RECENT_METRIC_ROWS = 10;

// ─── Tool definitions ──────────────────────────────────────────────────────
export const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description: 'List all 3DGS projects with status, image count, and training config.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project',
    description: 'Get full details for a specific project, including its latest training run.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (UUID)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new 3DGS project with a name and optional training config.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable project name' },
        description: { type: 'string', description: 'Brief scene description' },
        method: { type: 'string', enum: [...TRAINING_METHODS], default: 'splatfacto' },
        maxSteps: { type: 'integer', minimum: 1, default: 30000 },
        tags: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['name'],
    },
  },
  {
    name: 'start_training',
    description: 'Start a training run for a project. Returns a runId to track progress.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (UUID)' },
        method: { type: 'string', enum: [...TRAINING_METHODS], default: 'splatfacto' },
        maxSteps: { type: 'integer', minimum: 1, default: 30000 },
        skipProcessing: {
          type: 'boolean',
          description: 'Skip image processing if transforms.json already exists',
          default: false,
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'stop_training',
    description: 'Cancel a running training job.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run id returned by start_training' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'get_training_status',
    description: 'Get the latest training run status, recent log lines, and metrics (PSNR, loss).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (UUID)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_splats',
    description: 'List all completed .splat outputs across all projects.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_studio',
    description:
      'Open the 3DGS Studio web app in the default browser (returns the URL when running in a container).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional relative route inside the studio, e.g. "/?tab=chat"',
          default: '/',
        },
      },
      required: [],
    },
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────
function json(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Open a URL with the platform's default handler *without* a shell, so the
 * URL is passed as a single argv entry and cannot inject commands.
 */
export function defaultBrowserOpener(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    console.error(`[3dgs-mcp] could not launch browser via ${cmd}: ${err.message}`);
  });
  child.unref();
}

const PROJECT_SUMMARY_FIELDS = [
  'id',
  'name',
  'description',
  'status',
  'imageCount',
  'sourceType',
  'tags',
  'trainingConfig',
  'outputSplat',
  'gaussianCount',
  'createdAt',
  'updatedAt',
] as const;

function summarizeProject(meta: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const field of PROJECT_SUMMARY_FIELDS) {
    if (meta[field] !== undefined) summary[field] = meta[field];
  }
  return summary;
}

// ─── Dispatcher ────────────────────────────────────────────────────────────
export async function handleToolCall(
  name: string,
  rawArgs: unknown,
  config: Config,
  deps: ToolDeps = { openBrowser: defaultBrowserOpener },
): Promise<ToolResult> {
  try {
    const args = assertArgsObject(rawArgs);
    return await dispatch(name, args, config, deps);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResult(`Invalid arguments for ${name}: ${err.message}`);
    }
    if (err instanceof StudioError) {
      return errorResult(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[3dgs-mcp] ${name} failed: ${message}`);
    return errorResult(`Tool ${name} failed: ${message}`);
  }
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  config: Config,
  deps: ToolDeps,
): Promise<ToolResult> {
  switch (name) {
    case 'list_projects': {
      const projects = listProjectIds(config.projectsRoot)
        .map((id) => readMeta(config.projectsRoot, id))
        .filter((meta): meta is Record<string, unknown> => meta !== null)
        .map(summarizeProject);
      return json({ projects, count: projects.length });
    }

    case 'get_project': {
      const projectId = validateId(args.projectId, 'projectId');
      const project = readMeta(config.projectsRoot, projectId);
      if (!project) return errorResult(`Project ${projectId} not found.`);
      const run = readRun(config.projectsRoot, projectId);
      return json({ project, latestRun: run });
    }

    case 'create_project': {
      const body = {
        name: validateName(args.name),
        description: validateDescription(args.description),
        tags: validateTags(args.tags),
        trainingConfig: {
          method: validateMethod(args.method),
          maxSteps: validateMaxSteps(args.maxSteps),
        },
      };
      return json(await studioPost(config, '/api/projects', body));
    }

    case 'start_training': {
      const body = {
        projectId: validateId(args.projectId, 'projectId'),
        method: validateMethod(args.method),
        maxSteps: validateMaxSteps(args.maxSteps),
        skipProcessing: validateBoolean(args.skipProcessing, 'skipProcessing'),
      };
      return json(await studioPost(config, '/api/training/start', body));
    }

    case 'stop_training': {
      const runId = validateId(args.runId, 'runId');
      return json(await studioDelete(config, '/api/training/start', { runId }));
    }

    case 'get_training_status': {
      const projectId = validateId(args.projectId, 'projectId');
      const run = readRun(config.projectsRoot, projectId);
      if (!run) return errorResult(`No training run found for project ${projectId}.`);

      const logs = Array.isArray(run.logs) ? (run.logs as Array<{ message?: unknown }>) : [];
      const metrics = Array.isArray(run.metrics) ? (run.metrics as unknown[]) : [];
      const recentLogs = logs
        .slice(-RECENT_LOG_LINES)
        .map((entry) => (typeof entry?.message === 'string' ? entry.message : String(entry)));

      return json({
        runId: run.id,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        targetSteps: run.targetSteps,
        recentLogs,
        recentMetrics: metrics.slice(-RECENT_METRIC_ROWS),
        error: run.error,
      });
    }

    case 'list_splats': {
      const splats = listProjectIds(config.projectsRoot)
        .map((id) => {
          const meta = readMeta(config.projectsRoot, id);
          if (!meta) return null;
          const files = listSplatFiles(config.projectsRoot, id);
          return files.length === 0 ? null : { projectId: id, name: meta.name, splats: files };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return json({ splats, count: splats.length });
    }

    case 'open_studio': {
      const route = validateStudioPath(args.path);
      const url = buildStudioUrl(config.studioUrl, route);
      if (config.containerMode) {
        return textResult(`Studio is available at: ${url}`);
      }
      deps.openBrowser(url);
      return textResult(`Opened ${url} in browser.`);
    }

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}
