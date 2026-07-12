import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { ensurePiInstalled } from '../src/install';

const localRequire = createRequire(__filename);
type ExecModule = typeof import('@actions/exec');
type IoModule = typeof import('@actions/io');
const mutableExec = localRequire('@actions/exec') as { exec: ExecModule['exec'] };
const mutableIo = localRequire('@actions/io') as { which: IoModule['which'] };

interface ExecCall {
  command: string;
  args: string[];
}

async function withInstallMocks<T>(
  which: IoModule['which'],
  exec: ExecModule['exec'],
  fn: () => Promise<T>,
): Promise<T> {
  const originalWhich = mutableIo.which;
  const originalExec = mutableExec.exec;
  mutableIo.which = which;
  mutableExec.exec = exec;
  try {
    return await fn();
  } finally {
    mutableIo.which = originalWhich;
    mutableExec.exec = originalExec;
  }
}

test('ensurePiInstalled reuses an existing executable', async () => {
  let installs = 0;
  await withInstallMocks(
    async () => '/usr/local/bin/pi',
    async () => {
      installs += 1;
      return 0;
    },
    () => ensurePiInstalled('latest', []),
  );
  assert.equal(installs, 0);
});

test('ensurePiInstalled installs the requested version with extra npm args', async () => {
  const calls: ExecCall[] = [];
  let lookup = 0;
  await withInstallMocks(
    async () => {
      lookup += 1;
      return lookup === 1 ? '' : '/tmp/bin/pi';
    },
    async (command, args = []) => {
      calls.push({ command, args: [...args] });
      return 0;
    },
    () => ensurePiInstalled('1.2.3', ['--registry', 'https://registry.example']),
  );

  assert.deepEqual(calls, [
    {
      command: 'npm',
      args: [
        'install',
        '-g',
        '--ignore-scripts',
        '@earendil-works/pi-coding-agent@1.2.3',
        '--registry',
        'https://registry.example',
      ],
    },
  ]);
});

test('ensurePiInstalled reports when npm succeeds but pi is still unavailable', async () => {
  await assert.rejects(
    withInstallMocks(
      async () => '',
      async () => 0,
      () => ensurePiInstalled('latest', []),
    ),
    /not on PATH/,
  );
});
