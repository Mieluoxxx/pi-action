import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildPrompt } from '../src/prompt';
import type { TargetContext } from '../src/prompt';

const target: TargetContext = {
  kind: 'pull_request',
  number: 12,
  title: 'Add feature',
  body: 'This adds a thing.',
  author: 'alice',
};

test('buildPrompt includes task and repo', () => {
  const p = buildPrompt({
    task: 'Review the diff.',
    target,
    repo: { owner: 'acme', repo: 'demo' },
    writeMode: false,
    triggeredBy: 'alice',
  });
  assert.match(p, /Review the diff\./);
  assert.match(p, /acme\/demo/);
  assert.match(p, /Add feature/);
});

test('buildPrompt includes diff when provided', () => {
  const p = buildPrompt({
    task: 'x',
    target,
    diff: '+added line',
    repo: { owner: 'o', repo: 'r' },
    writeMode: false,
    triggeredBy: 'a',
  });
  assert.match(p, /\+added line/);
});

test('buildPrompt enforces read-only constraint when writeMode false', () => {
  const p = buildPrompt({
    task: 'x',
    target,
    repo: { owner: 'o', repo: 'r' },
    writeMode: false,
    triggeredBy: 'a',
  });
  assert.match(p, /READ-ONLY/);
});

test('buildPrompt allows edits when writeMode true', () => {
  const p = buildPrompt({
    task: 'x',
    target,
    repo: { owner: 'o', repo: 'r' },
    writeMode: true,
    triggeredBy: 'a',
  });
  assert.match(p, /edit files/);
});

test('buildPrompt uses fallback when task empty', () => {
  const p = buildPrompt({
    task: '   ',
    target,
    repo: { owner: 'o', repo: 'r' },
    writeMode: false,
    triggeredBy: 'a',
  });
  assert.match(p, /\(no explicit instruction/);
});

test('buildPrompt truncates oversized bodies and diffs', () => {
  const p = buildPrompt({
    task: 'review',
    target: { ...target, body: 'b'.repeat(20_100) },
    diff: `+${'d'.repeat(60_100)}`,
    repo: { owner: 'o', repo: 'r' },
    writeMode: false,
    triggeredBy: 'a',
  });
  assert.match(p, /truncated 100 chars/);
  assert.match(p, /truncated 101 chars/);
  assert.ok(p.length < 81_000);
});
