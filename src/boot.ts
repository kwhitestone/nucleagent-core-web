import { isLeavingForLogin } from "./addons/platform-api/shellLogin";
import { reportStartupFailure } from "./bootFailure";
import { startRuntimeApp } from "./bootstrap";
import { loadRuntimeConfig } from "./runtimeConfig";

let configLoaded = false;
void startRuntimeApp(async () => {
  await loadRuntimeConfig();
  configLoaded = true;
}, async () => {
  await (await import("./main")).startup;
}, window).catch((error: unknown) => {
  reportStartupFailure(error, {
    configLoaded,
    leavingForLogin: isLeavingForLogin(),
    root: document.getElementById("core-app"),
    log: (message, err) => console.error(message, err),
  });
});
