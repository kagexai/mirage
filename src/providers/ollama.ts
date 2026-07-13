import {
  ProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type Provider,
  type ProviderConfig,
} from "./types";

// Local Ollama adapter (/api/chat). No API key; runs against localhost:11434 by
// default. Deterministic options mirror how the FreakLab range drives Ollama.
export function createOllamaProvider(cfg: ProviderConfig): Provider {
  const model = cfg.model || "mistral:latest";
  const baseUrl = cfg.baseUrl || "http://localhost:11434";

  return {
    id: "ollama",
    model,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      const msgs: ChatMessage[] = opts.system
        ? [{ role: "system", content: opts.system }, ...messages]
        : messages;

      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: msgs,
          stream: false,
          options: {
            temperature: opts.temperature ?? 0.7,
            num_predict: opts.maxTokens ?? 512,
          },
        }),
        signal: opts.signal,
      });

      if (!res.ok) {
        throw new ProviderError(`Ollama ${res.status}: ${await safeText(res)}`, res.status);
      }
      const json = (await res.json()) as {
        message?: { content?: string };
        model?: string;
      };
      return { text: json.message?.content ?? "", model: json.model ?? model };
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "<no body>";
  }
}
