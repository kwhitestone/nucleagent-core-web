import type { PluginModule } from "@prism-fusion/plugin-runtime";
import { registerModelCatalog } from "@/contracts/model-catalog";
import { modelCatalog } from "./api/catalog";

let unregisterCatalog: (() => void) | undefined;

const modelCatalogPlugin: PluginModule = {
  name: "model-catalog",
  description: "Read-only provider and user-visible model catalog",
  manifest: {
    apiVersion: "prism-fusion/v2",
    kind: "frontend-addon",
    id: "model-catalog",
    version: "0.1.0",
    requires: [{ id: "platform-api" }],
    routeScopes: [],
  },
  setup() {
    unregisterCatalog = registerModelCatalog(modelCatalog);
  },
  destroy() {
    unregisterCatalog?.();
    unregisterCatalog = undefined;
  },
};

export default modelCatalogPlugin;
