import type { EngineEvent } from "@/src/engine/run";
import type { Settings } from "@/src/settings";

// Side panel → background (over a long-lived port).
export type PanelMessage =
  | { type: "start"; settings: Settings; tabId?: number }
  | { type: "stop" };

// Background → side panel is the EngineEvent stream.
export type BackgroundMessage = EngineEvent;

export const PORT_NAME = "mirage";
