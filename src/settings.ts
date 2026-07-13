import { DEFAULT_MODELS, type ProviderConfig, type ProviderId } from "@/src/providers/types";
import type { RunConfig } from "@/src/engine/run";

// Persisted operator settings. Keys live in chrome.storage.local (extension-
// scoped) and are never written into exported reports.
export interface Settings {
  // Attacker/judge brain — drives the whole adaptive loop.
  brain: ProviderConfig;
  // Provider used when the target is a direct API endpoint.
  targetApi: ProviderConfig;
  targetSystemPrompt: string;
  run: RunConfig;
  authorizedUse: boolean;
}

const STORAGE_KEY = "mirage.settings";

export function defaultSettings(): Settings {
  const provider = (id: ProviderId): ProviderConfig => ({ id, model: DEFAULT_MODELS[id] });
  return {
    brain: provider("anthropic"),
    targetApi: provider("ollama"),
    targetSystemPrompt: "",
    run: {
      targetKind: "tab",
      maxIterations: 12,
      scope: "",
      pace: "balanced",
      stopOnFirstWin: true,
    },
    authorizedUse: false,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  const base = defaultSettings();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    brain: { ...base.brain, ...raw.brain },
    targetApi: { ...base.targetApi, ...raw.targetApi },
    run: { ...base.run, ...raw.run },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
