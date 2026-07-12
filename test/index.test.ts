import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Config } from '../src/config';
import { decideTrigger } from '../src/decisions';
import type { EventKind } from '../src/events';

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

const PR_OPENED: EventKind = {
  kind: 'pull_request',
  action: 'opened',
  number: 1,
  title: 't',
  body: 'b',
  login: 'alice',
  headRef: 'feat',
  baseRef: 'main',
};

const ISSUE_OPENED: EventKind = {
  kind: 'issues',
  action: 'opened',
  number: 2,
  title: 't',
  body: 'b',
  login: 'carol',
};

function comment(body: string, login: string, isPr: boolean, assoc = 'OWNER'): EventKind {
  return {
    kind: 'issue_comment',
    action: 'created',
    number: 5,
    commentBody: body,
    commentId: 9,
    login,
    authorAssociation: assoc,
    isPr,
  };
}

test('decideTrigger skips self actor', () => {
  assert.equal(
    decideTrigger(PR_OPENED, makeConfig({ directPrompt: 'review' }), 'pi-action').run,
    false,
  );
  assert.equal(
    decideTrigger(PR_OPENED, makeConfig({ directPrompt: 'review' }), 'dependabot[bot]').run,
    false,
  );
});

test('decideTrigger runs direct prompt on opened PR', () => {
  const d = decideTrigger(PR_OPENED, makeConfig({ directPrompt: 'Review this PR.' }), 'alice');
  assert.equal(d.run, true);
  assert.equal(d.task, 'Review this PR.');
});

test('decideTrigger skips PR without direct prompt', () => {
  const d = decideTrigger(PR_OPENED, makeConfig({ directPrompt: '' }), 'alice');
  assert.equal(d.run, false);
});

test('decideTrigger skips labeled PR (not in open set)', () => {
  const labeled: EventKind = { ...PR_OPENED, action: 'labeled' };
  assert.equal(decideTrigger(labeled, makeConfig({ directPrompt: 'review' }), 'alice').run, false);
});

test('decideTrigger runs on issue opened with direct prompt', () => {
  const d = decideTrigger(
    ISSUE_OPENED,
    makeConfig({ directPrompt: 'Triage this issue.' }),
    'carol',
  );
  assert.equal(d.run, true);
  assert.equal(d.task, 'Triage this issue.');
});

test('decideTrigger triggers on @pi comment with task', () => {
  const d = decideTrigger(comment('@pi fix tests', 'bob', false), makeConfig(), 'bob');
  assert.equal(d.run, true);
  assert.equal(d.task, 'fix tests');
  assert.equal(d.triggeredBy, 'bob');
});

test('decideTrigger uses directPrompt as fallback for empty @pi', () => {
  const d = decideTrigger(
    comment('@pi', 'bob', true),
    makeConfig({ directPrompt: 'Help out.' }),
    'bob',
  );
  assert.equal(d.run, true);
  assert.equal(d.task, 'Help out.');
});

test('decideTrigger ignores comment without phrase', () => {
  const d = decideTrigger(comment('just chatting', 'bob', false), makeConfig(), 'bob');
  assert.equal(d.run, false);
});

test('decideTrigger ignores edited comments even when they contain the phrase', () => {
  const created = comment('@pi retry', 'bob', false);
  if (created.kind !== 'issue_comment') throw new Error('expected issue_comment');
  const edited: EventKind = { ...created, action: 'edited' };
  assert.equal(decideTrigger(edited, makeConfig(), 'bob').run, false);
});

test('decideTrigger denies @pi from non-write user (NONE) by default', () => {
  const d = decideTrigger(comment('@pi hi', 'stranger', false, 'NONE'), makeConfig(), 'stranger');
  assert.equal(d.run, false);
});

test('decideTrigger allows @pi from OWNER', () => {
  const d = decideTrigger(comment('@pi hi', 'alice', false, 'OWNER'), makeConfig(), 'alice');
  assert.equal(d.run, true);
});

test('decideTrigger allows allow-listed user without write permission', () => {
  const d = decideTrigger(
    comment('@pi hi', 'contrib', false, 'NONE'),
    makeConfig({ allowedUsers: ['contrib'] }),
    'contrib',
  );
  assert.equal(d.run, true);
});
