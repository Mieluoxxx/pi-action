import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Config } from '../src/config';
import { buildPiArgs, parseEvents, summarizeEvents } from '../src/pi-runner';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    piVersion: 'latest',
    provider: 'anthropic',
    model: '',
    apiKey: 'sk-test',
    triggerPhrase: '@pi',
    directPrompt: '',
    writeMode: false,
    thinking: 'medium',
    systemPrompt: '',
    appendSystemPrompt: '',
    excludeTools: [],
    extraArgs: [],
    installArgs: [],
    ...overrides,
  };
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
    {
      type: 'tool_execution_end',
      toolName: 'edit',
      args: { file: 'src/a.ts' },
      result: {},
      isError: false,
    },
    {
      type: 'tool_execution_end',
      toolName: 'write',
      args: { path: 'out.txt' },
      result: {},
      isError: false,
    },
    {
      type: 'tool_execution_end',
      toolName: 'edit',
      args: { file: 'src/a.ts' },
      result: {},
      isError: false,
    },
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

test('buildPiArgs read-only tools when writeMode false', () => {
  const args = buildPiArgs({ prompt: 'hi', config: makeConfig({ writeMode: false }), cwd: '/x' });
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('hi'));
  assert.ok(args.includes('--mode'));
  assert.ok(args.includes('json'));
  assert.ok(args.includes('--no-session'));
  const idx = args.indexOf('--tools');
  assert.notEqual(idx, -1);
  assert.equal(args[idx + 1], 'read,grep,find,ls');
});

test('buildPiArgs write tools when writeMode true', () => {
  const args = buildPiArgs({ prompt: 'hi', config: makeConfig({ writeMode: true }), cwd: '/x' });
  const idx = args.indexOf('--tools');
  assert.equal(args[idx + 1], 'read,grep,find,ls,edit,write,bash');
});

test('buildPiArgs respects excludeTools', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({ writeMode: false, excludeTools: ['grep', 'ls'] }),
    cwd: '/x',
  });
  const idx = args.indexOf('--tools');
  assert.equal(args[idx + 1], 'read,find');
});

test('buildPiArgs adds model and system prompt when provided', () => {
  const args = buildPiArgs({
    prompt: 'hi',
    config: makeConfig({ model: 'sonnet:high', systemPrompt: 'Be brief.' }),
    cwd: '/x',
  });
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('sonnet:high'));
  assert.ok(args.includes('--system-prompt'));
  assert.ok(args.includes('Be brief.'));
});
