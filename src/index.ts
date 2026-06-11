#!/usr/bin/env node
/**
 * 3DGS Studio MCP Server
 * Exposes the 3DGS pipeline as tools Claude can call natively.
 *
 * Tools:
 *   list_projects       — list all 3DGS projects
 *   get_project         — get project details + training run state
 *   create_project      — create a new project
 *   start_training      — trigger nerfstudio training
 *   stop_training       — cancel a running training job
 *   get_training_status — check logs and metrics for a run
 *   list_splats         — list completed .splat outputs
 *   open_studio         — open the 3DGS Studio web app in the browser
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Config ────────────────────────────────────────────────────────────────
const PROJECTS_ROOT =
  process.env.PROJECTS_ROOT ??
  path.join(os.homedir(), 'Documents/Claude/Projects/3DGS/projects');

// STUDIO_URL should include the basePath, e.g.:
//   host mode:      http://localhost:3000/3dgs-studio
//   container mode: http://host.containers.internal:3000/3dgs-studio
// The default keeps backwards-compat with the original bare localhost URL.
const STUDIO_URL = process.env.STUDIO_URL ?? 'http://localhost:3000';
const STUDIO_API = STUDIO_URL;

// Service key for server-to-server auth (bypasses session-cookie check in proxy.ts).
// Required when running in a container — set via STUDIO_SERVICE_KEY env var.
const SERVICE_KEY = process.env.STUDIO_SERVICE_KEY ?? '';

// Set CONTAINER_MODE=1 in the Podman wrapper script.
// Disables open_studio's execSync browser launch (no display in a container).
const CONTAINER_MODE = process.env.CONTAINER_MODE === '1';

// ─── Helpers ───────────────────────────────────────────────────────────────
function ensureRoot() {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
}

function readMeta(id: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECTS_ROOT, id, 'meta.json'), 'utf8'));
  } catch { return null; }
}

function listProjectIds(): string[] {
  ensureRoot();
  return fs.readdirSync(PROJECTS_ROOT).filter(f =>
    fs.statSync(path.join(PROJECTS_ROOT, f)).isDirectory()
  );
}

function readRun(projectId: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECTS_ROOT, projectId, 'run.json'), 'utf8'));
  } catch { return null; }
}

function serviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SERVICE_KEY) headers['x-service-key'] = SERVICE_KEY;
  return headers;
}

async function studioPost(path: string, body: unknown) {
  const res = await fetch(`${STUDIO_API}${path}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Tool definitions ──────────────────────────────────────────────────────
const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description: 'List all 3DGS projects with status, image count, and training info.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project',
    description: 'Get full details for a specific project, including its active training run.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project UUID' },
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
        method: {
          type: 'string',
          enum: ['splatfacto', 'nerfacto', 'instant-ngp'],
          default: 'splatfacto',
        },
        maxSteps: { type: 'number', default: 30000 },
        tags: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['name'],
    },
  },
  {
    name: 'start_training',
    description: 'Start a nerfstudio training run for a project. Returns runId to track progress.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        method: { type: 'string', default: 'splatfacto' },
        maxSteps: { type: 'number', default: 30000 },
        skipProcessing: {
          type: 'boolean',
          description: 'Skip COLMAP processing if transforms.json already exists',
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
        runId: { type: 'string', description: 'Run UUID returned by start_training' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'get_training_status',
    description: 'Get current training run status, recent logs, and metrics (PSNR, loss).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
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
    description: 'Open the 3DGS Studio web app in the default browser.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional route, e.g. /?tab=chat', default: '/' },
      },
      required: [],
    },
  },
];

// ─── Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: '3dgs-studio', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'list_projects': {
      const ids = listProjectIds();
      const projects = ids.map(readMeta).filter(Boolean);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ projects, count: projects.length }, null, 2),
        }],
      };
    }

    case 'get_project': {
      const { projectId } = args as { projectId: string };
      const project = readMeta(projectId);
      if (!project) return { content: [{ type: 'text', text: `Project ${projectId} not found.` }] };
      const run = readRun(projectId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ project, activeRun: run }, null, 2),
        }],
      };
    }

    case 'create_project': {
      const result = await studioPost('/api/projects', args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'start_training': {
      const result = await studioPost('/api/training/start', args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'stop_training': {
      const { runId } = args as { runId: string };
      const res = await fetch(`${STUDIO_API}/api/training/start`, {
        method: 'DELETE',
        headers: serviceHeaders(),
        body: JSON.stringify({ runId }),
      });
      return { content: [{ type: 'text', text: JSON.stringify(await res.json(), null, 2) }] };
    }

    case 'get_training_status': {
      const { projectId } = args as { projectId: string };
      const run = readRun(projectId);
      if (!run) return { content: [{ type: 'text', text: 'No training run found for this project.' }] };

      const logs = (run.logs as { message: string }[] ?? []).slice(-20).map(l => l.message);
      const metrics = (run.metrics as { step: number; psnr?: number; loss?: number }[] ?? []).slice(-10);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            recentLogs: logs,
            recentMetrics: metrics,
            error: run.error,
          }, null, 2),
        }],
      };
    }

    case 'list_splats': {
      const ids = listProjectIds();
      const splats = ids
        .map(id => {
          const meta = readMeta(id);
          if (!meta) return null;
          const outputDir = path.join(PROJECTS_ROOT, id, 'output');
          const splatFiles = fs.existsSync(outputDir)
            ? fs.readdirSync(outputDir, { recursive: true })
                .filter(f => String(f).endsWith('.splat'))
                .map(f => path.join(outputDir, String(f)))
            : [];
          if (splatFiles.length === 0) return null;
          return { projectId: id, name: meta.name, splats: splatFiles };
        })
        .filter(Boolean);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ splats, count: splats.length }, null, 2),
        }],
      };
    }

    case 'open_studio': {
      const { path: p = '/' } = args as { path?: string };
      const url = `${STUDIO_URL}${p}`;
      if (CONTAINER_MODE) {
        // Running inside a container — no display available, cannot launch browser.
        return { content: [{ type: 'text', text: `Studio is available at: ${url}` }] };
      }
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      execSync(`${openCmd} "${url}"`);
      return { content: [{ type: 'text', text: `Opened ${url} in browser.` }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[3DGS MCP] Server started on stdio.');
