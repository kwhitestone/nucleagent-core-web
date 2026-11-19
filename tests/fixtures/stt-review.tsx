import React from "react";
import { createRoot } from "react-dom/client";
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import axios from "axios";
import { registerPlatformRuntime } from "../../src/contracts/platform-runtime";
import { loadRuntimeConfig } from "../../src/runtimeConfig";
import { createConversation } from "../../src/addons/conversation/api/conversation";
import AdminTools from "../../src/addons/administration/views/admin/AdminTools.vue";
import { WorkflowForm } from "../../src/chat-react/WorkflowForm";
import { ZH_STRINGS } from "../../src/chat-react/islandStringsZh";
import zh from "../../src/i18n/zh";
import "../../src/styles/aurora.css";
import "../../src/chat-react/chat.css";

await loadRuntimeConfig("https://nucleagent-core-web.fixture.test", async () => fetch("/runtime-config.json"));
registerPlatformRuntime({ http: axios.create(), apiBase: () => "", authHeaders: () => ({}), getSessionVersion: () => 1, getAccessToken: () => "synthetic-owner-501", isInShell: () => false });
const app = createApp(AdminTools);
app.use(createI18n({ legacy: false, locale: "zh", messages: { zh } }));
app.mount("#admin");
createRoot(document.getElementById("workflow")!).render(<WorkflowForm t={(key) => ZH_STRINGS[key.replace("chatReact.", "") as keyof typeof ZH_STRINGS] ?? key} submit={async (toolInvocation, name) => {
  const response = await createConversation({ input: `运行工作流: ${name}`, toolIds: [toolInvocation.toolId], toolInvocation });
  document.getElementById("result")!.textContent = JSON.stringify(response);
}} />);
