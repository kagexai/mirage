import { createAnthropicProvider } from "./anthropic";
import { createOllamaProvider } from "./ollama";
import { createOpenAIProvider } from "./openai";
import { createXaiProvider } from "./xai";
import type { Provider, ProviderConfig } from "./types";

export * from "./types";

// Factory: build a provider from a stored config. One switch, four backends.
export function createProvider(cfg: ProviderConfig): Provider {
  switch (cfg.id) {
    case "anthropic":
      return createAnthropicProvider(cfg);
    case "openai":
      return createOpenAIProvider(cfg);
    case "xai":
      return createXaiProvider(cfg);
    case "ollama":
      return createOllamaProvider(cfg);
    default: {
      const _never: never = cfg.id;
      throw new Error(`unknown provider: ${String(_never)}`);
    }
  }
}
