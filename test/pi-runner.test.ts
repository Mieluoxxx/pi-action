import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import type { Config } from '../src/config';
import { buildPiArgs, parseEvents, runPi, summarizeEvents } from '../src/pi-runner';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    piVersion: 'latest',
    provider: 'anthropic',
    model: '',
    apiKey: 'sk-test',
    baseUrl: '',
    api: 'anthropic-messages',
    triggerPhrase: '@pi',
    directPrompt: '',
    writeMode: false,
    thinking: 'medium',
    systemPrompt: '',
    appendSystemPrompt: '',
    excludeTools: [],
    extraArgs: [],
    installArgs: [],
    timeoutSeconds: 600,
    allowedUsers: [],
    botId: '',
    botName: 'pi-action[bot]',
    ...overrides,
  };
}

async function withFakePi<T>(source: string, fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'pi-action-bin-'));
  const executable = join(dir, 'pi');
  writeFileSync(executable, `#!/bin/sh\n${source}\n`);
  chmodSync(executable, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = originalPath ? `${dir}${delimiter}${originalPath}` : dir;
  try {
    return await fn();
  } finally {
    if (originalPath === undefined) Reflect.deleteProperty(process.env, 'PATH');
    else process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parseEvents parses JSONL and skips junk', () => {
  const stdout = '{"type":"session","id":"1"}\nnot-json\n{"type":"agent_start"}\n';
  const events = parseEvents(stdout);
  assert.equal(events.length, 2);
});

test('summarizeEvents extracts final assistant text', () => {
  const r = summarizeEvents([
    {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Draft' }] },
    },
    {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Final' }] },
    },
    { type: 'agent_end', messages: [] },
  ]);
  assert.equal(r.text, 'Final');
  assert.equal(r.ok, true);
});

test('summarizeEvents falls back to streamed deltas', () => {
  const r = summarizeEvents([
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Streamed ' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'text' } },
  ]);
  assert.equal(r.text, 'Streamed text');
});

test('summarizeEvents collects written files deduped', () => {
  const r = summarizeEvents([
    { type: 'tool_execution_start', toolName: 'edit', args: { file: 'src/a.ts' } },
    { type: 'tool_execution_end', toolName: 'edit', result: {}, isError: false },
    { type: 'tool_execution_start', toolName: 'write', args: { path: 'out.txt' } },
    { type: 'tool_execution_end', toolName: 'write', result: {}, isError: false },
    { type: 'tool_execution_start', toolName: 'edit', args: { file: 'src/a.ts' } },
    { type: 'tool_execution_end', toolName: 'edit', result: {}, isError: false },
  ]);
  assert.deepEqual(r.writtenFiles, ['src/a.ts', 'out.txt']);
  assert.equal(r.toolCalls, 3);
});

test('summarizeEvents flags tool errors', () => {
  const r = summarizeEvents([
    {
      type: 'tool_execution_end',
      toolName: 'bash',
      args: {},
      result: { message: 'boom' },
      isError: true,
    },
  ]);
  assert.equal(r.errorMessage, 'boom');
});

test('summarizeEvents ignores non-assistant messages', () => {
  const r = summarizeEvents([
    { type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
  ]);
  assert.equal(r.text, '');
});

test('buildPiArgs enforces read-only tools when writeMode is false', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({ writeMode: false }),
    cwd: '/x',
    timeoutMs: 600000,
  });
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('hi'));
  assert.ok(args.includes('--mode'));
  assert.ok(args.includes('json'));
  assert.ok(args.includes('--no-session'));
  assert.equal(args[args.indexOf('--tools') + 1], 'read,grep,find,ls');
});

test('buildPiArgs enables write tools and applies exclusions in write mode', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({ writeMode: true, excludeTools: ['grep', 'bash'] }),
    cwd: '/x',
    timeoutMs: 600000,
  });
  assert.equal(args[args.indexOf('--tools') + 1], 'read,find,ls,edit,write');
});

test('buildPiArgs adds model and system prompt when provided', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({ model: 'sonnet:high', systemPrompt: 'Be brief.' }),
    cwd: '/x',
    timeoutMs: 600000,
  });
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('sonnet:high'));
  assert.ok(args.includes('--system-prompt'));
  assert.ok(args.includes('Be brief.'));
});

test('buildPiArgs omits --api-key for custom provider', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({ provider: 'custom', model: 'my-model' }),
    cwd: '/x',
    timeoutMs: 600000,
  });
  assert.ok(!args.includes('--api-key'));
  assert.equal(args[args.indexOf('--provider') + 1], 'custom');
  assert.equal(args[args.indexOf('--model') + 1], 'my-model');
});

test('buildPiArgs includes optional prompts, api key, and extra arguments', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({
      apiKey: 'secret',
      appendSystemPrompt: 'Append this.',
      extraArgs: ['--foo', 'bar'],
    }),
    cwd: '/x',
    timeoutMs: 1000,
  });
  assert.equal(args[args.indexOf('--api-key') + 1], 'secret');
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'Append this.');
  assert.deepEqual(args.slice(-2), ['--foo', 'bar']);
});

test('summarizeEvents captures filename writes and retry failures', () => {
  const result = summarizeEvents([
    { type: 'tool_execution_start', toolName: 'write', args: { filename: 'generated.txt' } },
    { type: 'tool_execution_end', toolName: 'write', isError: false },
    { type: 'auto_retry_end', success: false, finalError: 'provider unavailable' },
  ]);
  assert.deepEqual(result.writtenFiles, ['generated.txt']);
  assert.equal(result.errorMessage, 'provider unavailable');
  assert.equal(result.ok, false);
});

test('runPi executes JSONL mode and strips sensitive action environment variables', async (t) => {
  const saved = {
    github: process.env.GITHUB_TOKEN,
    gh: process.env.GH_TOKEN,
    input: process.env.INPUT_API_KEY,
    pi: process.env.PI_API_KEY,
  };
  process.env.GITHUB_TOKEN = 'github-secret';
  process.env.GH_TOKEN = 'gh-secret';
  process.env.INPUT_API_KEY = 'input-secret';
  process.env.PI_API_KEY = 'provider-secret';
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      const envKey =
        key === 'github'
          ? 'GITHUB_TOKEN'
          : key === 'gh'
            ? 'GH_TOKEN'
            : key === 'input'
              ? 'INPUT_API_KEY'
              : 'PI_API_KEY';
      if (value === undefined) Reflect.deleteProperty(process.env, envKey);
      else process.env[envKey] = value;
    }
  });

  const source = `
if [ -z "$GITHUB_TOKEN" ] && [ -z "$GH_TOKEN" ] && [ -z "$INPUT_API_KEY" ] && [ "$PI_API_KEY" = "provider-secret" ] && [ "$PI_OFFLINE" = "1" ] && [ "$PI_TELEMETRY" = "0" ]; then
  observed="env-ok"
else
  observed="env-bad"
fi
printf '%s\\n' '{"type":"tool_execution_start","toolName":"edit","args":{"path":"src/a.ts"}}'
printf '%s\\n' '{"type":"tool_execution_end","toolName":"edit","isError":false}'
printf '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}\\n' "$observed"`;

  const result = await withFakePi(source, () =>
    runPi({
      prompt: 'inspect env',
      config: makeConfig({ provider: 'custom', model: 'model' }),
      cwd: process.cwd(),
      timeoutMs: 2000,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(result.writtenFiles, ['src/a.ts']);
  assert.equal(result.text, 'env-ok');
});

test('runPi reports stderr and a non-zero exit when no answer is produced', async () => {
  const result = await withFakePi(
    `printf '%s\\n' 'provider failed' >&2
exit 7`,
    () =>
      runPi({
        prompt: 'fail',
        config: makeConfig(),
        cwd: process.cwd(),
        timeoutMs: 2000,
      }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.match(result.errorMessage ?? '', /provider failed/);
});

test('runPi enforces positive timeouts', async () => {
  const result = await withFakePi("trap 'exit 0' TERM\nwhile :; do :; done", () =>
    runPi({
      prompt: 'wait',
      config: makeConfig(),
      cwd: process.cwd(),
      timeoutMs: 40,
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.errorMessage ?? '', /timed out/);
});

test('runPi treats a zero timeout as no timeout', async () => {
  const source = `sleep 0.03
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"finished"}]}}'`;
  const result = await withFakePi(source, () =>
    runPi({
      prompt: 'wait briefly',
      config: makeConfig(),
      cwd: process.cwd(),
      timeoutMs: 0,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, 'finished');
});

test('runPi reports spawn failures', async () => {
  const emptyPath = mkdtempSync(join(tmpdir(), 'pi-action-empty-path-'));
  const originalPath = process.env.PATH;
  process.env.PATH = emptyPath;
  try {
    const result = await runPi({
      prompt: 'missing binary',
      config: makeConfig(),
      cwd: process.cwd(),
      timeoutMs: 1000,
    });
    assert.equal(result.ok, false);
    assert.match(result.errorMessage ?? '', /failed to spawn pi/);
  } finally {
    if (originalPath === undefined) Reflect.deleteProperty(process.env, 'PATH');
    else process.env.PATH = originalPath;
    rmSync(emptyPath, { recursive: true, force: true });
  }
});
