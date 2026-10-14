// UI-IMPL-6H: the home composer's 「＋图片/视频」 send — a new chat (conversationId 0)
// with the generation in it, then open it in that kind's mode. Video asks first
// (same dialog/skip as the chat page). Relative imports only (node --test).
import type { MediaModel } from "./generation.ts";
import { needsConfirm, requestParams, type GenKind, type GenParams } from "../registry.ts";

/** The "don't remind me" key used on home (no conversation exists yet). */
export const HOME_CONFIRM_KEY = "home";

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export interface HomeGenDeps {
  create(body: Record<string, unknown>): Promise<{ conversationId?: number }>;
  push(to: { path: string; query: { gen: GenKind } }): Promise<unknown>;
  /** Shows the video confirm; resolves true to go ahead. */
  confirm(): Promise<boolean>;
  ls?: KV;
}

/** false = cancelled at the confirm (nothing created). Errors propagate. */
export async function createGenChat(d: HomeGenDeps, kind: GenKind, m: MediaModel, prompt: string, params: GenParams): Promise<boolean> {
  if (needsConfirm(kind, HOME_CONFIRM_KEY, d.ls) && !(await d.confirm())) return false;
  const created = await d.create({ kind, providerId: m.providerId, model: m.model, prompt, conversationId: 0, ...requestParams(kind, params) });
  await d.push({ path: `/c/${created.conversationId}`, query: { gen: kind } });
  return true;
}
