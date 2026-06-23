export interface TriggerResult {
  triggered: boolean;
  /** User instruction with the trigger phrase removed; empty if phrase absent. */
  prompt: string;
}

/**
 * Detect whether a comment invokes the agent. Triggered when the phrase appears
 * anywhere in the body. The returned prompt is the text *after* the first
 * occurrence of the phrase; if that is empty, the caller supplies a default.
 */
export function parseTrigger(commentBody: string, phrase: string): TriggerResult {
  const idx = commentBody.indexOf(phrase);
  if (idx === -1) {
    return { triggered: false, prompt: '' };
  }
  const after = commentBody.slice(idx + phrase.length).trim();
  return { triggered: true, prompt: after };
}

/**
 * Boolean form of {@link parseTrigger} for callers that only need the yes/no.
 */
export function containsTrigger(commentBody: string, phrase: string): boolean {
  return parseTrigger(commentBody, phrase).triggered;
}
