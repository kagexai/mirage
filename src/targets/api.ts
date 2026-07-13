import type { ChatMessage, Provider } from "@/src/providers/types";
import type { Target, TargetResponse } from "./types";

// Direct-API target: the thing under test IS a provider endpoint. Conversation
// history is kept so multi-turn probes escalate against a coherent context.
export function createApiTarget(provider: Provider, systemPrompt?: string): Target {
  let history: ChatMessage[] = [];

  return {
    kind: "api",
    label: `API · ${provider.id}/${provider.model}`,
    async send(prompt: string, signal?: AbortSignal): Promise<TargetResponse> {
      history.push({ role: "user", content: prompt });
      const result = await provider.chat(history, {
        system: systemPrompt,
        maxTokens: 512,
        signal,
      });
      history.push({ role: "assistant", content: result.text });
      return { response: result.text };
    },
    reset() {
      history = [];
    },
  };
}
