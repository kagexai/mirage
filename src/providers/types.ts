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

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  xai: "grok-4.5",
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
