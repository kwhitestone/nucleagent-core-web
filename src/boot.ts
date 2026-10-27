import { startRuntimeApp } from "./bootstrap";
import { loadRuntimeConfig } from "./runtimeConfig";

let configLoaded = false;
void startRuntimeApp(async () => {
  await loadRuntimeConfig();
  configLoaded = true;
}, async () => {
  await (await import("./main")).startup;
}, window).catch((error: unknown) => {
  // Runtime-config errors redact values (key names only). Log so a mount failure is no longer
  // indistinguishable from a config failure; the banner text stays generic.
  console.error(`NucleAgent Core startup failed (${configLoaded ? "app mount" : "runtime config"}):`, error);
  const root = document.getElementById("core-app");
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = configLoaded
      ? "NucleAgent Core failed to start. Please refresh; contact support if it persists."
      : "NucleAgent Core failed to start: runtime configuration is missing, invalid, or unavailable.";
  }
});
