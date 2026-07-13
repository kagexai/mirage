import { defineBackground } from "wxt/sandbox";
import { runAgent } from "@/src/engine/agent";
import { createProvider } from "@/src/providers";
import { createApiTarget } from "@/src/targets/api";
import { createTabTarget } from "@/src/targets/tab";
import type { Target } from "@/src/targets/types";
import { PORT_NAME, type PanelMessage } from "@/src/messaging";
import type { EngineEvent } from "@/src/engine/run";

// The service worker hosts the adaptive red-team agent: it receives a run config
// from the side panel over a port and streams EngineEvents (agent reasoning +
// findings) back. Keeping the loop here means a run survives the panel losing
// focus and can reach content scripts for the tab target.
export default defineBackground(() => {
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn("[mirage] sidePanel behavior:", e));

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    let abort: AbortController | null = null;

    port.onMessage.addListener((msg: PanelMessage) => {
      if (msg.type === "stop") {
        abort?.abort();
        return;
      }
      if (msg.type === "start") {
        abort?.abort();
        abort = new AbortController();
        void startRun(msg, abort.signal, (event) => safePost(port, event));
      }
    });

    port.onDisconnect.addListener(() => abort?.abort());
  });
});

async function startRun(
  msg: Extract<PanelMessage, { type: "start" }>,
  signal: AbortSignal,
  emit: (event: EngineEvent) => void,
): Promise<void> {
  try {
    const { settings } = msg;

    // The brain drives the whole loop — it is required in agent mode.
    if (settings.brain.id !== "ollama" && !settings.brain.apiKey) {
      emit({ type: "run:error", message: `set an API key for the attacker model (${settings.brain.id})` });
      return;
    }
    const brain = createProvider(settings.brain);

    let target: Target;
    if (settings.run.targetKind === "api") {
      target = createApiTarget(
        createProvider(settings.targetApi),
        settings.targetSystemPrompt || undefined,
      );
    } else {
      const tabId = msg.tabId;
      if (tabId == null) {
        emit({ type: "run:error", message: "no active tab to target" });
        return;
      }
      target = createTabTarget(tabId);
    }

    await runAgent({ config: settings.run, target, brain, emit, signal });
  } catch (e) {
    emit({ type: "run:error", message: e instanceof Error ? e.message : String(e) });
  }
}

function safePost(port: chrome.runtime.Port, event: EngineEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // panel disconnected mid-run; the abort listener will stop the loop.
  }
}
