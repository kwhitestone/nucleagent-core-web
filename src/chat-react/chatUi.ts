import { configValue } from "../runtimeConfig.ts";

/**
 * MUYU-365 switch (plan §6): `?chatUi=` > localStorage `nucleagent_chat_ui` > runtime-config
 * `CHAT_UI_DEFAULT` (old|react, per environment) > "vue".
 */
export type ChatUi = "vue" | "react";

export const CHAT_UI_KEY = "nucleagent_chat_ui";

const envDefault = (): ChatUi | undefined => {
  try { return configValue("CHAT_UI_DEFAULT") === "react" ? "react" : undefined; } catch { return undefined; /* config not loaded */ }
};

export function chatUi(
  search = globalThis.location?.search ?? "",
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
  fallback: () => ChatUi | undefined = envDefault,
): ChatUi {
  const pick = (value: string | null | undefined) => (value === "react" || value === "vue" ? value : undefined);
  let stored: string | null = null;
  try { stored = storage?.getItem(CHAT_UI_KEY) ?? null; } catch { /* storage blocked: default */ }
  return pick(new URLSearchParams(search).get("chatUi")) ?? pick(stored) ?? fallback() ?? "vue";
}
