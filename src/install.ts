import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';

const PACKAGE = '@earendil-works/pi-coding-agent';

/** Ensure the `pi` CLI is on PATH; install it globally via npm if missing. */
export async function ensurePiInstalled(
  version: string,
  installArgs: readonly string[],
): Promise<void> {
  const existing = await io.which('pi', false);
  if (existing) {
    core.info(`Found existing pi at ${existing}`);
    return;
  }

  const spec =
    version === 'latest' || version === '' ? `${PACKAGE}@latest` : `${PACKAGE}@${version}`;
  core.info(`Installing ${spec} ...`);
  await exec.exec('npm', ['install', '-g', '--ignore-scripts', spec, ...installArgs]);

  const resolved = await io.which('pi', false);
  if (!resolved) {
    throw new Error(`Installed ${spec} but \`pi\` is not on PATH. Check npm global bin directory.`);
  }
  core.info(`Installed pi: ${resolved}`);
}
