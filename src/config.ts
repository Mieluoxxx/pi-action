import * as core from '@actions/core';

export interface Config {
  piVersion: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  api: string;
  triggerPhrase: string;
  directPrompt: string;
  writeMode: boolean;
  thinking: string;
  systemPrompt: string;
  appendSystemPrompt: string;
  excludeTools: string[];
  extraArgs: string[];
  installArgs: string[];
  timeoutSeconds: number;
  allowedUsers: string[];
  botId: string;
  botName: string;
}

export const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;
export const WRITE_TOOLS = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'] as const;

function splitArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTimeout(value: string): number {
  const raw = value || '600';
  if (!/^\d+$/.test(raw)) {
    throw new Error('`timeout` input must be a non-negative integer.');
  }
  const timeout = Number(raw);
  if (!Number.isSafeInteger(timeout)) {
    throw new Error('`timeout` input must be a non-negative integer.');
  }
  return timeout;
}

export function loadConfig(): Config {
  const baseUrl = core.getInput('base_url');
  const model = core.getInput('model');
  if (baseUrl && !model) {
    throw new Error('`model` input is required when `base_url` is set.');
  }
  return {
    piVersion: core.getInput('pi_version') || 'latest',
    provider: baseUrl ? 'custom' : core.getInput('provider') || 'anthropic',
    model,
    apiKey: core.getInput('api_key'),
    baseUrl,
    api: core.getInput('api') || 'anthropic-messages',
    triggerPhrase: core.getInput('trigger_phrase') || '@pi-agent',
    directPrompt: core.getInput('direct_prompt'),
    writeMode: core.getBooleanInput('write_mode'),
    thinking: core.getInput('thinking') || 'medium',
    systemPrompt: core.getInput('system_prompt'),
    appendSystemPrompt: core.getInput('append_system_prompt'),
    excludeTools: splitList(core.getInput('exclude_tools')),
    extraArgs: splitArgs(core.getInput('extra_args')),
    installArgs: splitArgs(core.getInput('install_args')),
    timeoutSeconds: parseTimeout(core.getInput('timeout')),
    allowedUsers: splitList(core.getInput('allowed_users')),
    botId: core.getInput('bot_id'),
    botName: core.getInput('bot_name') || 'pi-action[bot]',
  };
}

/** Return the tool allowlist enforced for the selected write policy. */
export function toolsFor(config: Config): string[] {
  const base = config.writeMode ? [...WRITE_TOOLS] : [...READ_ONLY_TOOLS];
  return base.filter((tool) => !config.excludeTools.includes(tool));
}
