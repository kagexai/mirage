import {
  ProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type Provider,
  type ProviderConfig,
} from "./types";
import { fetchWithRetry, isNetworkError, networkErrorMessage, safeText } from "./http";

// Local Ollama adapter (/api/chat). No API key; runs against localhost:11434 by
// default. Deterministic options mirror how the FreakLab range drives Ollama.
export function createOllamaProvider(cfg: ProviderConfig): Provider {
  const model = cfg.model || "mistral:latest";
  const baseUrl = (cfg.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  return {
    id: "ollama",
    model,
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
      const msgs: ChatMessage[] = opts.system
        ? [{ role: "system", content: opts.system }, ...messages]
        : messages;

      let res: Response;
      try {
        res = await fetchWithRetry(
          url,
          {
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
          },
          { retries: 1, label: "Ollama" },
        );
      } catch (e) {
        if (isNetworkError(e) || e instanceof TypeError) {
          throw new ProviderError(
            networkErrorMessage("Ollama", url, e) +
              " Is Ollama running? Try: ollama serve && ollama pull " +
              model,
          );
        }
        throw e;
      }

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
