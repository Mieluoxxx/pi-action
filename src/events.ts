import * as core from '@actions/core';

export interface PullRequestEvent {
  kind: 'pull_request';
  action: string;
  number: number;
  title: string;
  body: string;
  login: string;
  headRef: string;
  baseRef: string;
}

export interface IssueCommentEvent {
  kind: 'issue_comment';
  action: string;
  number: number;
  commentBody: string;
  commentId: number;
  login: string;
  isPr: boolean;
}

export interface IssuesEvent {
  kind: 'issues';
  action: string;
  number: number;
  title: string;
  body: string;
  login: string;
}

export type EventKind = PullRequestEvent | IssueCommentEvent | IssuesEvent | { kind: 'unknown' };

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null;
}

/** Coerce an unknown to a trimmed string. Boundary helper used across all event branches. */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Coerce an unknown to a finite number, defaulting to 0. Boundary helper. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Read a nested object field safely, or null. */
function field(parent: Bag, key: string): Bag | null {
  const child = parent[key];
  return isBag(child) ? child : null;
}

/** Classify the current GitHub webhook payload into a structured event. */
export function classifyEvent(eventName: string, payload: unknown): EventKind {
  const root = isBag(payload) ? payload : null;
  if (!root) return { kind: 'unknown' };

  if (eventName === 'pull_request') {
    const pr = field(root, 'pull_request');
    if (!pr) return { kind: 'unknown' };
    const user = field(pr, 'user');
    const head = field(pr, 'head');
    const base = field(pr, 'base');
    return {
      kind: 'pull_request',
      action: str(root.action),
      number: num(root.number),
      title: str(pr.title),
      body: str(pr.body),
      login: user ? str(user.login) : '',
      headRef: head ? str(head.ref) : '',
      baseRef: base ? str(base.ref) : '',
    };
  }

  if (eventName === 'issue_comment') {
    const issue = field(root, 'issue');
    const comment = field(root, 'comment');
    if (!issue || !comment) return { kind: 'unknown' };
    return {
      kind: 'issue_comment',
      action: str(root.action),
      number: num(issue.number),
      commentBody: str(comment.body),
      commentId: num(comment.id),
      login: str(field(comment, 'user')?.login),
      isPr: Boolean('pull_request' in issue && issue.pull_request),
    };
  }

  if (eventName === 'issues') {
    const issue = field(root, 'issue');
    if (!issue) return { kind: 'unknown' };
    return {
      kind: 'issues',
      action: str(root.action),
      number: num(issue.number),
      title: str(issue.title),
      body: str(issue.body),
      login: str(field(issue, 'user')?.login),
    };
  }

  return { kind: 'unknown' };
}

const PR_OPEN_ACTIONS: Record<string, true> = {
  opened: true,
  reopened: true,
  synchronize: true,
  ready_for_review: true,
};
const ISSUE_OPEN_ACTIONS: Record<string, true> = { opened: true, reopened: true };

/** Should this event be processed at all given the workflow trigger filters? */
export function shouldHandle(event: EventKind): boolean {
  switch (event.kind) {
    case 'pull_request':
      return PR_OPEN_ACTIONS[event.action] === true;
    case 'issue_comment':
      return event.action === 'created';
    case 'issues':
      return ISSUE_OPEN_ACTIONS[event.action] === true;
    default:
      return false;
  }
}

/** Human-readable label for logging / comments. */
export function describeTarget(event: EventKind): string {
  switch (event.kind) {
    case 'pull_request':
      return `PR #${event.number}`;
    case 'issues':
      return `issue #${event.number}`;
    case 'issue_comment':
      return event.isPr ? `PR #${event.number}` : `issue #${event.number}`;
    default:
      return 'unknown target';
  }
}

export function logEvent(event: EventKind): void {
  if (event.kind === 'unknown') {
    core.info('Unhandled event; skipping.');
    return;
  }
  core.info(`Event: ${event.kind} .${event.action} on ${describeTarget(event)} by @${event.login}`);
}
