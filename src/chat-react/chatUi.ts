import { configValue } from "../runtimeConfig.ts";

/**
 * MUYU-365 switch (plan §6, §16): `?chatUi=` in location.search > `chatUi=` in the hash query
 * (`#/chat?chatUi=react`, how the shell forwards it) > localStorage `nucleagent_chat_ui` >
 * runtime-config `CHAT_UI_DEFAULT` (old|react, per environment) > "vue".
 * A valid URL value is persisted so in-app hash rewrites keep the choice; `?chatUi=vue` switches back.
 */
export type ChatUi = "vue" | "react";

export const CHAT_UI_KEY = "nucleagent_chat_ui";

const envDefault = (): ChatUi | undefined => {
  try { return configValue("CHAT_UI_DEFAULT") === "react" ? "react" : undefined; } catch { return undefined; /* config not loaded */ }
};

const pick = (value: string | null | undefined) => (value === "react" || value === "vue" ? value : undefined);
const param = (query: string) => pick(new URLSearchParams(query).get("chatUi"));

export function chatUi(
  search = globalThis.location?.search ?? "",
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
  fallback: () => ChatUi | undefined = envDefault,
  hash = globalThis.location?.hash ?? "",
): ChatUi {
  const q = hash.indexOf("?");
  const fromUrl = param(search) ?? (q < 0 ? undefined : param(hash.slice(q + 1)));
  try {
    if (fromUrl) storage?.setItem(CHAT_UI_KEY, fromUrl);
    return fromUrl ?? pick(storage?.getItem(CHAT_UI_KEY)) ?? fallback() ?? "vue";
  } catch { /* storage blocked: this load only */ }
  return fromUrl ?? fallback() ?? "vue";
}

let chosen: ChatUi | undefined;
/** vue-router caches a route's resolved component, so one choice holds for the whole page load. */
export const loadedChatUi = (): ChatUi => (chosen ??= chatUi());

/**
 * In the shell, Core boots at `#/chat` before the shell's view message adds `?chatUi=`, so /chat is
 * already resolved: take the query if nothing was chosen yet, reload if it asks for the other UI.
 */
export function followChatUiQuery(asked: unknown, reload: () => void): void {
  if (asked !== "react" && asked !== "vue") return;
  if (!chosen) chosen = chatUi(`?chatUi=${asked}`);
  else if (asked !== chosen) reload();
}
