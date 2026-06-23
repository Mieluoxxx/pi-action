import type { Config } from './config';
import { type EventKind, shouldHandle } from './events';
import { parseTrigger } from './trigger';

const FALLBACK_TASK = 'Investigate and respond to this item.';

export interface TriggerDecision {
  run: boolean;
  task: string;
  triggeredBy: string;
}

const SKIP: TriggerDecision = { run: false, task: '', triggeredBy: '' };

/** Pure decision: should pi run, and with what task. Exported for tests. */
export function decideTrigger(event: EventKind, config: Config, actor: string): TriggerDecision {
  const self = actor === 'pi-action' || actor.endsWith('[bot]');
  if (self) return SKIP;

  if (event.kind === 'issue_comment') {
    const t = parseTrigger(event.commentBody, config.triggerPhrase);
    if (!t.triggered) return SKIP;
    return {
      run: true,
      task: t.prompt || config.directPrompt || FALLBACK_TASK,
      triggeredBy: event.login,
    };
  }

  if (
    (event.kind === 'pull_request' || event.kind === 'issues') &&
    config.directPrompt.length > 0 &&
    shouldHandle(event)
  ) {
    return { run: true, task: config.directPrompt, triggeredBy: event.login };
  }

  return SKIP;
}
