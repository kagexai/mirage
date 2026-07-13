import {
  ProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type Provider,
  type ProviderConfig,
  type ProviderId,
} from "./types";

// Shared OpenAI-compatible /chat/completions adapter. OpenAI and xAI (Grok) both
// speak this schema, so xai.ts just supplies a different id + base URL.
export function createOpenAICompatibleProvider(
  cfg: ProviderConfig,
  opts: { id: ProviderId; baseUrl: string; label: string },
): Provider {
  const model = cfg.model;
  const baseUrl = cfg.baseUrl || opts.baseUrl;

  return {
    id: opts.id,
    model,
    async chat(messages: ChatMessage[], chatOpts: ChatOptions = {}): Promise<ChatResult> {
      if (!cfg.apiKey) throw new ProviderError(`${opts.label} API key not set`);

      const msgs: ChatMessage[] = chatOpts.system
        ? [{ role: "system", content: chatOpts.system }, ...messages]
        : messages;

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: msgs,
          max_tokens: chatOpts.maxTokens ?? 1024,
          temperature: chatOpts.temperature ?? 0.7,
        }),
        signal: chatOpts.signal,
      });

      if (!res.ok) {
        throw new ProviderError(`${opts.label} ${res.status}: ${await safeText(res)}`, res.status);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
      };
      return {
        text: json.choices?.[0]?.message?.content ?? "",
        model: json.model ?? model,
      };
    },
  };
}

export function createOpenAIProvider(cfg: ProviderConfig): Provider {
  return createOpenAICompatibleProvider(
    { ...cfg, model: cfg.model || "gpt-4o" },
    { id: "openai", baseUrl: "https://api.openai.com", label: "OpenAI" },
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "<no body>";
  }
}
