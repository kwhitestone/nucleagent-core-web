/**
 * MUYU-365 switch (plan §6): `?chatUi=` > localStorage `nucleagent_chat_ui` > "vue".
 * shortcut: no runtime-config CHAT_UI_DEFAULT key yet (decision U4), add it with the deploy repo change.
 */
export type ChatUi = "vue" | "react";

export const CHAT_UI_KEY = "nucleagent_chat_ui";

export function chatUi(search = globalThis.location?.search ?? "", storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): ChatUi {
  const pick = (value: string | null | undefined) => (value === "react" || value === "vue" ? value : undefined);
  let stored: string | null = null;
  try { stored = storage?.getItem(CHAT_UI_KEY) ?? null; } catch { /* storage blocked: default */ }
  return pick(new URLSearchParams(search).get("chatUi")) ?? pick(stored) ?? "vue";
}
