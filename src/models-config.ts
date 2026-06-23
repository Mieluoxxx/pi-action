import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CustomModelConfig {
  baseUrl: string;
  api: string;
  modelId: string;
  /** Environment variable name whose value is the API key (referenced as $VAR in models.json). */
  apiKeyEnv: string;
  contextWindow: number;
  maxTokens: number;
  /** Provider key in models.json; defaults to "custom". */
  providerName?: string;
}

/**
 * Build the JSON for ~/.pi/agent/models.json registering a custom Anthropic-messages
 * compatible provider. Pure function (for tests).
 */
export function buildModelsJson(c: CustomModelConfig): string {
  const providerName = c.providerName ?? 'custom';
  const config = {
    providers: {
      [providerName]: {
        baseUrl: c.baseUrl,
        api: c.api,
        apiKey: `$${c.apiKeyEnv}`,
        models: [
          {
            id: c.modelId,
            name: c.modelId,
            reasoning: false,
            input: ['text'],
            contextWindow: c.contextWindow,
            maxTokens: c.maxTokens,
          },
        ],
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

/** Write models.json to ~/.pi/agent/. Returns the written file path. */
export function writeModelsJson(content: string): string {
  const dir = path.join(os.homedir(), '.pi', 'agent');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'models.json');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}
