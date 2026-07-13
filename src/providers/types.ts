// A provider is any chat-completion backend. The same interface powers the
// attacker/judge "brain" and — via targets/api.ts — the system under test.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  system?: string;
  maxTokens?: number;
  // Some callers (e.g. the judge) want low-variance output.
  temperature?: number;
  signal?: AbortSignal;
  // Hint that the caller wants a JSON object (OpenAI/xAI honor response_format).
  // Reduces parse retries when the brain must return structured decisions.
  jsonMode?: boolean;
}

export interface ChatResult {
  text: string;
  // Which model actually answered (useful in reports).
  model: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly model: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
}

export const PROVIDER_IDS = ["anthropic", "openai", "xai", "ollama"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderConfig {
  id: ProviderId;
  model: string;
  apiKey?: string;
  // Override the default base URL (self-hosted, proxy, alt Ollama host).
  baseUrl?: string;
}

// Prefer latency-friendly defaults for the attacker loop (one call per iteration).
// Operators can switch to flagship models in Settings when quality matters more.
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  xai: "grok-4-fast",
  ollama: "mistral:latest",
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
