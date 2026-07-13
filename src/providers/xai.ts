import { createOpenAICompatibleProvider } from "./openai";
import type { Provider, ProviderConfig } from "./types";

// Grok (xAI) exposes an OpenAI-compatible surface at api.x.ai.
export function createXaiProvider(cfg: ProviderConfig): Provider {
  return createOpenAICompatibleProvider(
    { ...cfg, model: cfg.model || "grok-4-fast" },
    { id: "xai", baseUrl: "https://api.x.ai", label: "xAI Grok" },
  );
}
