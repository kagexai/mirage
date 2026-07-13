import { defineConfig } from "wxt";

// Mirage — MV3 red-team extension.
// Broad page host access is required so the tab-target adapter can inject into
// whatever site the operator is authorized to test (not only kagex.ai).
// LLM API hosts stay listed explicitly for provider calls.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  manifest: {
    name: "Mirage — AI Red Teamer",
    description:
      "Attack your AI like a real attacker would. OWASP-LLM plugin packs, multi-provider, deterministic scoring. Authorized use only.",
    permissions: ["storage", "activeTab", "scripting", "sidePanel", "tabs"],
    host_permissions: [
      // Tab under test — any http(s) page the operator has open.
      "http://*/*",
      "https://*/*",
      // Attacker / target LLM APIs
      "https://api.anthropic.com/*",
      "https://api.openai.com/*",
      "https://api.x.ai/*",
      "http://localhost:11434/*",
      "http://127.0.0.1:11434/*",
    ],
    action: {
      default_title: "Mirage — AI Red Teamer",
      default_icon: { "16": "icon/16.png", "48": "icon/48.png", "128": "icon/128.png" },
    },
  },
});
