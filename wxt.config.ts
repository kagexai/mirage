import { defineConfig } from "wxt";

// Mirage — MV3 red-team extension.
// Host permissions are scoped to the four supported providers plus <all_urls>
// so the tab-target adapter can drive an AI chat UI on any site under test.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  manifest: {
    name: "Mirage — AI Red Teamer",
    description:
      "Attack your AI like a real attacker would. OWASP-LLM plugin packs, multi-provider, deterministic scoring. Authorized use only.",
    permissions: ["storage", "activeTab", "scripting", "sidePanel", "tabs"],
    host_permissions: [
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
      "https://api.x.ai/*",
      "http://localhost:11434/*",
      "http://127.0.0.1:11434/*",
      "<all_urls>",
    ],
    action: {
      default_title: "Mirage — AI Red Teamer",
      default_icon: { "16": "icon/16.png", "48": "icon/48.png", "128": "icon/128.png" },
    },
  },
});
