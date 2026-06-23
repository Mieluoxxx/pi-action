import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildModelsJson } from '../src/models-config';

test('buildModelsJson registers custom provider with env-referenced key', () => {
  const json = buildModelsJson({
    baseUrl: 'https://gateway.example.com',
    api: 'anthropic-messages',
    modelId: 'my-claude',
    apiKeyEnv: 'PI_API_KEY',
  });
  const cfg = JSON.parse(json);
  const provider = cfg.providers.custom;
  assert.equal(provider.baseUrl, 'https://gateway.example.com');
  assert.equal(provider.api, 'anthropic-messages');
  assert.equal(provider.apiKey, '$PI_API_KEY');
  assert.equal(provider.models[0].id, 'my-claude');
});

test('buildModelsJson supports a custom provider name', () => {
  const json = buildModelsJson({
    baseUrl: 'https://gw.example.com',
    api: 'openai-completions',
    modelId: 'gpt-custom',
    apiKeyEnv: 'KEY',
    providerName: 'my-gw',
  });
  const cfg = JSON.parse(json);
  assert.ok(cfg.providers['my-gw']);
  assert.equal(cfg.providers.custom, undefined);
  assert.equal(cfg.providers['my-gw'].apiKey, '$KEY');
});
