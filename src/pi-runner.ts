import * as core from '@actions/core';
import { spawn } from 'node:child_process';
import { type Config } from './config';

export interface PiResult {
  ok: boolean;
  /** Final assistant text (concatenated text blocks of the last assistant message). */
  text: string;
  exitCode: number;
  /** File paths touched by edit/write tools, in order, with duplicates removed. */
  writtenFiles: string[];
  toolCalls: number;
  errorMessage?: string;
}

export interface RunPiOptions {
  prompt: string;
  config: Config;
  cwd: string;
  /** Hard kill pi after this many milliseconds. */
  timeoutMs: number;
}

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null;
}

function pickText(message: unknown): string {
  if (!isBag(message)) return '';
  const role = message.role;
  if (role !== 'assistant') return '';
  const content = message.content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const part of content) {
    if (isBag(part) && part.type === 'text' && typeof part.text === 'string') {
      out += part.text;
    }
  }
  return out;
}

function pickDelta(evt: unknown): string {
  const inner = isBag(evt) ? field(evt, 'assistantMessageEvent') : null;
  if (!inner) return '';
  if (inner.type !== 'text_delta') return '';
  return typeof inner.delta === 'string' ? inner.delta : '';
}

function field(parent: Bag, key: string): Bag | null {
  const child = parent[key];
  return isBag(child) ? child : null;
}

function filePathFromArgs(args: unknown): string | null {
  if (!isBag(args)) return null;
  for (const k of ['file', 'path', 'filename']) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Parse JSONL stdout into a list of event objects, skipping unparseable lines. */
export function parseEvents(stdout: string): unknown[] {
  const out: unknown[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      core.warning(`Unparseable pi JSON line: ${trimmed.slice(0, 200)}`);
    }
  }
  return out;
}

/** Extract the structured result from pi's JSONL event stream. Pure function. */
export function summarizeEvents(events: unknown[]): PiResult {
  let lastAssistant = '';
  let deltaFallback = '';
  const written: string[] = [];
  let toolCalls = 0;
  let errorMessage: string | undefined;

  for (const raw of events) {
    const evt = isBag(raw) ? raw : null;
    if (!evt) continue;
    const type = typeof evt.type === 'string' ? evt.type : '';

    if (type === 'message_end') {
      const text = pickText(evt.message);
      if (text) lastAssistant = text;
    } else if (type === 'message_update') {
      const delta = pickDelta(evt);
      if (delta) deltaFallback += delta;
    } else if (type === 'tool_execution_start') {
      const toolName = typeof evt.toolName === 'string' ? evt.toolName : '';
      if (toolName === 'edit' || toolName === 'write') {
        const fp = filePathFromArgs(evt.args);
        core.info(`[pi-write] ${toolName} ${fp ?? '(unknown)'}`);
        if (fp && !written.includes(fp)) written.push(fp);
      }
    } else if (type === 'tool_execution_end') {
      toolCalls += 1;
      const toolName = typeof evt.toolName === 'string' ? evt.toolName : '';
      if (evt.isError === true) {
        const r = evt.result;
        core.info(`[pi-tool-error] toolName=${toolName || '(unknown)'} result=${JSON.stringify(r ?? '').slice(0, 500)}`);
        errorMessage = isBag(r) && typeof r.message === 'string' ? r.message : 'tool error';
      }
    } else if (type === 'auto_retry_end') {
      if (evt.success === false && typeof evt.finalError === 'string') {
        errorMessage = evt.finalError;
      }
    }
  }

  const text = lastAssistant || deltaFallback;
  const ok = text.length > 0 || errorMessage === undefined;

  return {
    ok,
    text,
    exitCode: 0,
    writtenFiles: written,
    toolCalls,
    errorMessage,
  };
}

/** Build the argv passed to `pi`. Pure function (for tests). */
export function buildPiArgs(opts: RunPiOptions): string[] {
  const c = opts.config;
  const args = [
    '-p',
    opts.prompt,
    '--mode',
    'json',
    '--no-session',
    '-a',
    '--provider',
    c.provider,
    '--thinking',
    c.thinking,
  ];
  // custom provider reads key from models.json + env; built-in providers take --api-key
  if (c.provider !== 'custom' && c.apiKey) {
    args.push('--api-key', c.apiKey);
  }
  if (c.model) args.push('--model', c.model);
  if (c.systemPrompt) args.push('--system-prompt', c.systemPrompt);
  if (c.appendSystemPrompt) args.push('--append-system-prompt', c.appendSystemPrompt);
  if (c.excludeTools.length > 0) args.push('--exclude-tools', c.excludeTools.join(','));
  args.push(...c.extraArgs);
  return args;
}

function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  // Strip git push credentials and action inputs (which carry the api key) so
  // pi's bash tool cannot authenticate a rogue `git push`. PI_API_KEY is set
  // separately by index.ts and is intentionally kept — pi needs it for the API.
  return upper === 'GITHUB_TOKEN' || upper === 'GH_TOKEN' || upper.startsWith('INPUT_');
}

function buildPiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue;
    if (isSensitiveEnvKey(k)) continue;
    env[k] = v;
  }
  env.PI_OFFLINE = '1';
  env.PI_SKIP_VERSION_CHECK = '1';
  env.PI_TELEMETRY = '0';
  env.DISABLE_AUTOUPDATER = '1';
  return env;
}

/** Spawn `pi` in print+json mode, kill it after timeoutMs, summarize its event stream. */
export async function runPi(opts: RunPiOptions): Promise<PiResult> {
  const args = buildPiArgs(opts);
  const env = buildPiEnv();
  core.info(`Running: pi ${args.map((a) => (a === opts.config.apiKey ? '***' : a)).join(' ')}`);

  return new Promise<PiResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      const events = parseEvents(stdout);
      const result = summarizeEvents(events);
      result.exitCode = code ?? -1;
      if (timedOut) {
        result.ok = false;
        result.errorMessage = `pi timed out after ${Math.round(opts.timeoutMs / 1000)}s`;
      } else if ((code ?? 0) !== 0 && !result.text) {
        result.ok = false;
        result.errorMessage =
          result.errorMessage ?? (stderr.trim().slice(0, 2000) || `pi exited with code ${code}`);
      }
      if (stderr.trim()) core.info(`pi stderr (tail):\n${stderr.slice(-2000)}`);
      core.info(
        `pi done: exit=${code} tools=${result.toolCalls} written=${result.writtenFiles.length} text=${result.text.length} chars timedOut=${timedOut}`,
      );
      resolve(result);
    };

    const child = spawn('pi', args, {
      cwd: opts.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      core.warning(`pi exceeded ${opts.timeoutMs}ms, killing (SIGTERM then SIGKILL)`);
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // process already exited
        }
      }, 5000);
    }, opts.timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        text: '',
        exitCode: -1,
        writtenFiles: [],
        toolCalls: 0,
        errorMessage: `failed to spawn pi: ${err.message}`,
      });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}
