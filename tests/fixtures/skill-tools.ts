import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import axios from "axios";
import { registerPlatformRuntime, type PlatformRuntime } from "../../src/contracts/platform-runtime";
import AdminSkills from "../../src/addons/administration/views/admin/AdminSkills.vue";
import AdminTools from "../../src/addons/administration/views/admin/AdminTools.vue";
import SkillPicker from "../../src/addons/conversation/components/SkillPicker.vue";
import ToolPicker from "../../src/addons/conversation/components/ToolPicker.vue";
import en from "../../src/i18n/en";
import zh from "../../src/i18n/zh";
import "../../src/styles/aurora.css";

const http = axios.create();
registerPlatformRuntime({
  http, apiBase: () => "", authHeaders: () => ({}),
  getSessionVersion: () => 1, getAccessToken: () => "", isInShell: () => false,
} as PlatformRuntime);
const app = createApp({
  setup() {
    const view = ref("skills"), skills = ref<number[]>([]), tools = ref<number[]>([]);
    return () => h("main", { style: "max-width:1100px;margin:0 auto;padding:20px" }, [
      h("h1", { style: "font-size:22px;margin-bottom:16px" }, "NucleAgent"),
      h("nav", { style: "display:flex;gap:16px;margin-bottom:20px" },
        ["skills","tools","conversation"].map(name => h("button", { onClick: () => { view.value = name; } }, name))),
      view.value === "skills" ? h(AdminSkills) : view.value === "tools" ? h(AdminTools) : h("section", [
        h(SkillPicker, { modelValue: skills.value, "onUpdate:modelValue": (ids: number[]) => { skills.value = ids; } }),
        h(ToolPicker, { tools: [], modelValue: tools.value, skillIds: skills.value, "onUpdate:modelValue": (ids: number[]) => { tools.value = ids; } }),
      ]),
    ]);
  },
});
app.use(createI18n({ legacy: false, locale: "zh", messages: { en, zh } }));
app.mount("#app");
