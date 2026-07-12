import * as core from '@actions/core';
import { runAction } from './action';

runAction().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
});
