import { startRuntimeApp } from "./bootstrap";
import { loadRuntimeConfig } from "./runtimeConfig";

void startRuntimeApp(loadRuntimeConfig, async () => {
  await (await import("./main")).startup;
}, window).catch(() => {
  const root = document.getElementById("core-app");
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = "NucleAgent Core failed to start: runtime configuration is missing, invalid, or unavailable.";
  }
});
