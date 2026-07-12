import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { loadConfig, toolsFor } from '../src/config';

const localRequire = createRequire(__filename);
type CoreModule = typeof import('@actions/core');
const mutableCore = localRequire('@actions/core') as {
  getInput: CoreModule['getInput'];
  getBooleanInput: CoreModule['getBooleanInput'];
};

function withInputs<T>(inputs: Record<string, string>, fn: () => T): T {
  const originalGetInput = mutableCore.getInput;
  const originalGetBooleanInput = mutableCore.getBooleanInput;
  mutableCore.getInput = (name) => inputs[name] ?? '';
  mutableCore.getBooleanInput = (name) => (inputs[name] ?? '').toLowerCase() === 'true';
  try {
    return fn();
  } finally {
    mutableCore.getInput = originalGetInput;
    mutableCore.getBooleanInput = originalGetBooleanInput;
  }
}

test('loadConfig applies defaults and parses list/argument inputs', () => {
  const config = withInputs(
    {
      api_key: 'secret',
      write_mode: 'true',
      exclude_tools: ' bash, write ,,',
      extra_args: ' --foo  value ',
      install_args: ' --registry https://registry.example ',
      allowed_users: 'alice, bob',
    },
    loadConfig,
  );

  assert.equal(config.piVersion, 'latest');
  assert.equal(config.provider, 'anthropic');
  assert.equal(config.triggerPhrase, '@pi-agent');
  assert.equal(config.timeoutSeconds, 600);
  assert.equal(config.writeMode, true);
  assert.deepEqual(config.excludeTools, ['bash', 'write']);
  assert.deepEqual(config.extraArgs, ['--foo', 'value']);
  assert.deepEqual(config.installArgs, ['--registry', 'https://registry.example']);
  assert.deepEqual(config.allowedUsers, ['alice', 'bob']);
  assert.equal(config.botName, 'pi-action[bot]');
});

test('loadConfig forces custom provider and requires a model for base_url', () => {
  const config = withInputs(
    {
      base_url: 'https://gateway.example',
      provider: 'openai',
      model: 'custom-model',
      api: 'openai-responses',
    },
    loadConfig,
  );
  assert.equal(config.provider, 'custom');
  assert.equal(config.api, 'openai-responses');
  assert.equal(config.model, 'custom-model');

  assert.throws(
    () => withInputs({ base_url: 'https://gateway.example' }, loadConfig),
    /model.*required/,
  );
});

test('loadConfig accepts zero timeout and rejects invalid values', () => {
  assert.equal(withInputs({ timeout: '0' }, loadConfig).timeoutSeconds, 0);
  assert.equal(withInputs({ timeout: '15' }, loadConfig).timeoutSeconds, 15);
  assert.throws(() => withInputs({ timeout: '-1' }, loadConfig), /non-negative integer/);
  assert.throws(() => withInputs({ timeout: 'invalid' }, loadConfig), /non-negative integer/);
  assert.throws(() => withInputs({ timeout: '12seconds' }, loadConfig), /non-negative integer/);
  assert.throws(
    () => withInputs({ timeout: '999999999999999999999' }, loadConfig),
    /non-negative integer/,
  );
});

test('toolsFor enforces read-only and write-mode allowlists with exclusions', () => {
  const readOnly = withInputs({}, loadConfig);
  assert.deepEqual(toolsFor(readOnly), ['read', 'grep', 'find', 'ls']);

  const writable = withInputs({ write_mode: 'true', exclude_tools: 'bash,find' }, loadConfig);
  assert.deepEqual(toolsFor(writable), ['read', 'grep', 'ls', 'edit', 'write']);
});
