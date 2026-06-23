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
}

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
    triggerPhrase: core.getInput('trigger_phrase') || '@pi',
    directPrompt: core.getInput('direct_prompt'),
    writeMode: core.getBooleanInput('write_mode'),
    thinking: core.getInput('thinking') || 'medium',
    systemPrompt: core.getInput('system_prompt'),
    appendSystemPrompt: core.getInput('append_system_prompt'),
    excludeTools: splitList(core.getInput('exclude_tools')),
    extraArgs: splitArgs(core.getInput('extra_args')),
    installArgs: splitArgs(core.getInput('install_args')),
  };
}

/** Tool allowlist enforced regardless of write_mode. */
export const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;
export const WRITE_TOOLS = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'] as const;

export function toolsFor(config: Config): string[] {
  const base = config.writeMode ? [...WRITE_TOOLS] : [...READ_ONLY_TOOLS];
  return base.filter((t) => !config.excludeTools.includes(t));
}
