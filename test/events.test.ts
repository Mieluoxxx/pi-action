import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyEvent, describeTarget, shouldHandle } from '../src/events';

test('classifyEvent handles pull_request', () => {
  const e = classifyEvent('pull_request', {
    action: 'opened',
    number: 42,
    pull_request: {
      title: 'Fix bug',
      body: 'body text',
      user: { login: 'alice' },
      head: { ref: 'feature' },
      base: { ref: 'main' },
    },
  });
  if (e.kind !== 'pull_request') throw new Error(`expected pull_request, got ${e.kind}`);
  assert.equal(e.number, 42);
  assert.equal(e.title, 'Fix bug');
  assert.equal(e.login, 'alice');
  assert.equal(e.headRef, 'feature');
  assert.equal(e.baseRef, 'main');
});

test('classifyEvent handles issue_comment on PR', () => {
  const e = classifyEvent('issue_comment', {
    action: 'created',
    issue: { number: 7, pull_request: {} },
    comment: { id: 99, body: '@pi hi', user: { login: 'bob' }, author_association: 'OWNER' },
  });
  if (e.kind !== 'issue_comment') throw new Error(`expected issue_comment, got ${e.kind}`);
  assert.equal(e.number, 7);
  assert.equal(e.commentBody, '@pi hi');
  assert.equal(e.login, 'bob');
  assert.equal(e.isPr, true);
  assert.equal(e.authorAssociation, 'OWNER');
});

test('classifyEvent handles issues', () => {
  const e = classifyEvent('issues', {
    action: 'opened',
    issue: { number: 3, title: 'Bug', body: 'desc', user: { login: 'carol' } },
  });
  if (e.kind !== 'issues') throw new Error(`expected issues, got ${e.kind}`);
  assert.equal(e.number, 3);
  assert.equal(e.title, 'Bug');
  assert.equal(e.login, 'carol');
});

test('classifyEvent returns unknown for malformed payload', () => {
  assert.equal(classifyEvent('pull_request', {}).kind, 'unknown');
  assert.equal(classifyEvent('pull_request', null).kind, 'unknown');
  assert.equal(classifyEvent('unknown_event', { x: 1 }).kind, 'unknown');
});

test('shouldHandle filters PR actions', () => {
  const opened = {
    kind: 'pull_request' as const,
    action: 'opened',
    number: 1,
    title: '',
    body: '',
    login: '',
    headRef: '',
    baseRef: '',
  };
  const labeled = { ...opened, action: 'labeled' };
  assert.equal(shouldHandle(opened), true);
  assert.equal(shouldHandle(labeled), false);
});

test('shouldHandle only allows created comments', () => {
  const created = {
    kind: 'issue_comment' as const,
    action: 'created',
    number: 1,
    commentBody: '',
    commentId: 0,
    login: '',
    isPr: false,
    authorAssociation: 'OWNER',
  };
  const edited = { ...created, action: 'edited' };
  assert.equal(shouldHandle(created), true);
  assert.equal(shouldHandle(edited), false);
});

test('describeTarget labels PR vs issue', () => {
  const pr = {
    kind: 'pull_request' as const,
    action: 'opened',
    number: 5,
    title: '',
    body: '',
    login: '',
    headRef: '',
    baseRef: '',
  };
  const issue = {
    kind: 'issues' as const,
    action: 'opened',
    number: 9,
    title: '',
    body: '',
    login: '',
  };
  assert.equal(describeTarget(pr), 'PR #5');
  assert.equal(describeTarget(issue), 'issue #9');
});
