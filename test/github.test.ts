import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildCommentBody, buildRemoteUrl, commitAndPush } from '../src/github';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

async function createRepository(): Promise<{ root: string; work: string; remote: string }> {
  const root = mkdtempSync(join(tmpdir(), 'pi-action-git-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  mkdirSync(work);
  await git(root, ['init', '--bare', remote]);
  await git(work, ['init']);
  await git(work, ['config', 'user.name', 'Initial User']);
  await git(work, ['config', 'user.email', 'initial@example.com']);
  writeFileSync(join(work, 'README.md'), 'before\n');
  await git(work, ['add', 'README.md']);
  await git(work, ['commit', '-m', 'initial']);
  await git(work, ['branch', '-M', 'feature']);
  await git(work, ['remote', 'add', 'origin', remote]);
  await git(work, ['push', '-u', 'origin', 'feature']);
  return { root, work, remote };
}

test('buildRemoteUrl and buildCommentBody format GitHub output', () => {
  assert.equal(
    buildRemoteUrl('token', 'acme', 'demo'),
    'https://x-access-token:token@github.com/acme/demo.git',
  );

  const body = buildCommentBody({
    text: 'Done.',
    errorMessage: 'one tool failed',
    writtenFiles: ['src/a.ts', 'README.md'],
    pushed: true,
    triggeredBy: 'alice',
  });
  assert.match(body, /^Done\./);
  assert.match(body, /Committed changes to.*`src\/a\.ts`.*`README\.md`/s);
  assert.match(body, /⚠️ one tool failed/);
  assert.match(body, /triggered by @alice/);

  assert.match(
    buildCommentBody({ text: '', writtenFiles: [], pushed: false, triggeredBy: 'bob' }),
    /pi produced no output/,
  );
});

test('commitAndPush returns without changing the remote when the tree is clean', async (t) => {
  const repo = await createRepository();
  t.after(() => rmSync(repo.root, { recursive: true, force: true }));

  const result = await commitAndPush({
    token: 'test-token',
    repo: { owner: 'acme', repo: 'demo' },
    branch: 'feature',
    message: 'no changes',
    cwd: repo.work,
    botId: '',
    botName: 'pi-action[bot]',
  });

  assert.deepEqual(result, { pushed: false, commitSha: '', changedFiles: [] });
  assert.equal(await git(repo.work, ['remote', 'get-url', 'origin']), repo.remote);
});

test('commitAndPush stages all changes, commits with bot identity, and pushes', async (t) => {
  const repo = await createRepository();
  t.after(() => rmSync(repo.root, { recursive: true, force: true }));
  const expectedRemote = buildRemoteUrl('test-token', 'acme', 'demo');
  const localRemote = pathToFileURL(repo.remote).href;
  await git(repo.work, ['config', `url.${localRemote}.insteadOf`, expectedRemote]);

  writeFileSync(join(repo.work, 'README.md'), 'after\n');
  writeFileSync(join(repo.work, 'new.txt'), 'created\n');

  const result = await commitAndPush({
    token: 'test-token',
    repo: { owner: 'acme', repo: 'demo' },
    branch: 'feature',
    message: 'pi-action: update files',
    cwd: repo.work,
    botId: '12345',
    botName: 'pi-action[bot]',
  });

  assert.equal(result.pushed, true);
  assert.match(result.commitSha, /^[0-9a-f]{40}$/);
  assert.deepEqual(result.changedFiles, ['README.md', 'new.txt']);
  assert.equal(await git(repo.remote, ['show', 'feature:README.md']), 'after');
  assert.equal(readFileSync(join(repo.work, 'new.txt'), 'utf8'), 'created\n');
  assert.equal(
    await git(repo.work, ['log', '-1', '--format=%an|%ae']),
    'pi-action[bot]|12345+pi-action[bot]@users.noreply.github.com',
  );
});
