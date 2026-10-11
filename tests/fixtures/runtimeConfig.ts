import type { ViteDevServer } from "vite";

export async function initializeRuntimeFixture(vite: ViteDevServer) {
  const { loadRuntimeConfig } = await vite.ssrLoadModule("/src/runtimeConfig.ts");
  const config = runtimeFixture();
  await loadRuntimeConfig(config.VITE_CORE_WEB_URL, async () => new Response(JSON.stringify(config)));
}

export function runtimeFixture(zone = "dev.ndaeweb.com") {
  return {
    VITE_CORE_WEB_URL: `https://nucleagent-core-web.${zone}`,
    VITE_SHELL_URL: `https://nucleagent-web.${zone}`,
    VITE_CORE_BACKEND_URL: `https://nucleagent-core-web.${zone}`,
    VITE_STORAGE_URL: `https://nucleagent-storage.${zone}`,
    VITE_AUTH_BACKEND_URL: `https://nucleagent-auth.${zone}`,
    VITE_EMBED_HOST_ORIGINS: `https://agentia-engine-web.${zone}`,
  };
}
