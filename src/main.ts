import {
  createPluginHost,
  type HeadlessPluginHost,
} from "@prism-fusion/plugin-runtime";
import { createPinia } from "pinia";
import { createApp, type App as VueApp } from "vue";

import administration from "./addons/administration";
import conversation from "./addons/conversation";
import modelCatalog from "./addons/model-catalog";
import platformApi from "./addons/platform-api";
import App from "./App.vue";
import i18n from "./i18n";
import router, { coreRoutes } from "./router";
import "./styles/aurora.css";
import "./styles/global.css";

const MOUNT_ID = "core-app";

let app: VueApp | null = null;
let host: HeadlessPluginHost | null = null;

async function mount(): Promise<void> {
  if (app) return;
  const nextApp = createApp(App);
  nextApp.use(createPinia());
  nextApp.use(i18n);

  const nextHost = createPluginHost({
    app: nextApp,
    router,
    coreRoutes,
    homePath: "/chat",
  });
  nextHost.register([platformApi, modelCatalog, administration, conversation]);
  await nextHost.install();
  nextApp.use(router);
  await router.isReady();
  nextApp.mount(`#${MOUNT_ID}`);
  app = nextApp;
  host = nextHost;

  if (!(globalThis as Record<string, unknown>).__MICRO_APP_ENVIRONMENT__) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
  }
}

async function unmount(): Promise<void> {
  await host?.uninstall();
  host = null;
  app?.unmount();
  app = null;
}

const w = globalThis as Record<string, unknown>;
if (w.__MICRO_APP_ENVIRONMENT__) {
  w.mount = mount;
  w.unmount = unmount;
} else {
  void mount();
}
