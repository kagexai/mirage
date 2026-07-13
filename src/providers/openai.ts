import {
  ProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type Provider,
  type ProviderConfig,
  type ProviderId,
} from "./types";
import {
  chatCompletionsUrl,
  fetchWithRetry,
  isNetworkError,
  networkErrorMessage,
  safeText,
} from "./http";

// Shared OpenAI-compatible /chat/completions adapter. OpenAI and xAI (Grok) both
// speak this schema, so xai.ts just supplies a different id + base URL.
export function createOpenAICompatibleProvider(
  cfg: ProviderConfig,
  opts: { id: ProviderId; baseUrl: string; label: string },
): Provider {
  const model = cfg.model;
  const baseUrl = cfg.baseUrl || opts.baseUrl;
  const url = chatCompletionsUrl(baseUrl);

  return {
    id: opts.id,
    model,
    async chat(messages: ChatMessage[], chatOpts: ChatOptions = {}): Promise<ChatResult> {
      if (!cfg.apiKey) throw new ProviderError(`${opts.label} API key not set`);

      const msgs: ChatMessage[] = chatOpts.system
        ? [{ role: "system", content: chatOpts.system }, ...messages]
        : messages;

      const buildBody = (jsonMode: boolean): Record<string, unknown> => {
        const body: Record<string, unknown> = {
          model,
          messages: msgs,
          max_tokens: chatOpts.maxTokens ?? 1024,
          temperature: chatOpts.temperature ?? 0.7,
        };
        // Some OpenAI-compatible hosts reject response_format — we fall back below.
        if (jsonMode && chatOpts.jsonMode) {
          body.response_format = { type: "json_object" };
        }
        return body;
      };

      const doFetch = async (jsonMode: boolean): Promise<Response> => {
        try {
          return await fetchWithRetry(
            url,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${cfg.apiKey}`,
              },
              body: JSON.stringify(buildBody(jsonMode)),
              signal: chatOpts.signal,
            },
            { retries: 1, label: opts.label },
          );
        } catch (e) {
          if (isNetworkError(e) || (e instanceof TypeError)) {
            throw new ProviderError(networkErrorMessage(opts.label, url, e));
          }
          throw e;
        }
      };

      let res = await doFetch(!!chatOpts.jsonMode);

      // If the host rejects json_object mode, retry once without it.
      if (!res.ok && chatOpts.jsonMode && (res.status === 400 || res.status === 422)) {
        const body = await safeText(res);
        if (/response_format|json_object|json mode/i.test(body)) {
          res = await doFetch(false);
        } else {
          throw new ProviderError(`${opts.label} ${res.status}: ${body}`, res.status);
        }
      }

      if (!res.ok) {
        const body = await safeText(res);
        if (res.status === 401 || res.status === 403) {
          throw new ProviderError(
            `${opts.label} auth failed HTTP ${res.status}. Check API key. ${body}`,
            res.status,
          );
        }
        if (res.status === 404) {
          throw new ProviderError(
            `${opts.label} HTTP 404 from ${url} (model=${model}). Confirm the model id. ${body}`,
            res.status,
          );
        }
        throw new ProviderError(`${opts.label} ${res.status}: ${body}`, res.status);
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
    { ...cfg, model: cfg.model || "gpt-4o-mini" },
    { id: "openai", baseUrl: "https://api.openai.com", label: "OpenAI" },
  );
}
