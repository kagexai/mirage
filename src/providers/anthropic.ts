import {
  ProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type Provider,
  type ProviderConfig,
} from "./types";

// Anthropic Messages API adapter. `system` is a top-level field (not a message
// role), so we split it out. The browser-access header opts into direct calls
// from an extension context.
export function createAnthropicProvider(cfg: ProviderConfig): Provider {
  const model = cfg.model || "claude-opus-4-8";
  const baseUrl = cfg.baseUrl || "https://api.anthropic.com";

  return {
    id: "anthropic",
    model,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      if (!cfg.apiKey) throw new ProviderError("Anthropic API key not set");

      const system = opts.system ?? extractSystem(messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: opts.maxTokens ?? 1024,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      };
      if (system) body.system = system;

      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!res.ok) {
        throw new ProviderError(`Anthropic ${res.status}: ${await safeText(res)}`, res.status);
      }
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
        model?: string;
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      return { text, model: json.model ?? model };
    },
  };
}

function extractSystem(messages: ChatMessage[]): string | undefined {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content);
  return sys.length ? sys.join("\n\n") : undefined;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "<no body>";
  }
}
