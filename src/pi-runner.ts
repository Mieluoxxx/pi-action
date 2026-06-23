import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { type Config, toolsFor } from './config';

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
    } else if (type === 'tool_execution_end') {
      toolCalls += 1;
      if (evt.isError === true) {
        const r = evt.result;
        errorMessage = isBag(r) && typeof r.message === 'string' ? r.message : 'tool error';
      }
      const toolName = typeof evt.toolName === 'string' ? evt.toolName : '';
      if (toolName === 'edit' || toolName === 'write') {
        const fp = filePathFromArgs(evt.args);
        if (fp && !written.includes(fp)) written.push(fp);
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
    '--api-key',
    c.apiKey,
    '--thinking',
    c.thinking,
    '--tools',
    toolsFor(c).join(','),
  ];
  if (c.model) args.push('--model', c.model);
  if (c.systemPrompt) args.push('--system-prompt', c.systemPrompt);
  if (c.appendSystemPrompt) args.push('--append-system-prompt', c.appendSystemPrompt);
  args.push(...c.extraArgs);
  return args;
}

function buildPiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.PI_OFFLINE = '1';
  env.PI_SKIP_VERSION_CHECK = '1';
  env.PI_TELEMETRY = '0';
  env.DISABLE_AUTOUPDATER = '1';
  return env;
}

/** Spawn `pi` in print+json mode and summarize its event stream. */
export async function runPi(opts: RunPiOptions): Promise<PiResult> {
  const args = buildPiArgs(opts);
  core.info(`Running: pi ${args.map((a) => (a === opts.config.apiKey ? '***' : a)).join(' ')}`);

  let stdout = '';
  let stderr = '';
  const exitCode = await exec.exec('pi', args, {
    cwd: opts.cwd,
    env: buildPiEnv(),
    silent: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
      stderr: (data) => {
        stderr += data.toString();
      },
    },
    ignoreReturnCode: true,
  });

  const events = parseEvents(stdout);
  const result = summarizeEvents(events);
  result.exitCode = exitCode;

  if (exitCode !== 0 && !result.text) {
    result.ok = false;
    result.errorMessage =
      result.errorMessage ?? (stderr.trim().slice(0, 2000) || `pi exited with code ${exitCode}`);
  }

  if (stderr.trim()) {
    core.info(`pi stderr (tail):\n${stderr.slice(-2000)}`);
  }

  core.info(
    `pi done: exit=${exitCode} tools=${result.toolCalls} written=${result.writtenFiles.length} text=${result.text.length} chars`,
  );
  return result;
}
