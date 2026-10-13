// UI-IMPL-3: pure logic of in-conversation image generation (design §3).
// Relative imports only: loaded natively by node --test (coverage-gated).
import { PENDING } from "./generation.ts";

export const ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const COUNTS = [1, 2, 3, 4] as const;
export const DEFAULT_PARAMS: { aspect: Aspect; count: number } = { aspect: "1:1", count: 1 };
/** Image typical time (design §1.5): copy says 「预计约 20 秒」. */
export const EXPECTED_MS = 20_000;

export function aspectRatio(aspect: string): string {
  return (ASPECTS as readonly string[]).includes(aspect) ? aspect.replace(":", " / ") : "1 / 1";
}

export type GridLayout = "single" | "pair" | "trio" | "quad";
export function gridLayout(n: number): GridLayout {
  return n <= 1 ? "single" : n === 2 ? "pair" : n === 3 ? "trio" : "quad";
}

/** Stage copy key under chatGen.stage.* (images have no running stage). */
export function stageKey(status: string): "queued" | "submitting" | "ingesting" {
  if (status === "queued") return "queued";
  if (status === "ingesting") return "ingesting";
  return "submitting";
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Past 2× the expected time the card stops quoting a number. */
export const isSlow = (elapsedMs: number): boolean => elapsedMs > 2 * EXPECTED_MS;

export const cancellable = (status: string): boolean => (PENDING as readonly string[]).includes(status);
export const cancelNoteKey = (submitted: boolean): string =>
  submitted ? "chatGen.cancelledCharged" : "chatGen.cancelledFree";

export interface ErrorCard {
  code: string;
  tone: "fail" | "warn";
  action: "retry" | "edit" | "usage";
}
const ERROR_CARDS: Record<string, Omit<ErrorCard, "code">> = {
  upstream_error: { tone: "fail", action: "retry" },
  upstream_timeout: { tone: "fail", action: "retry" },
  content_rejected: { tone: "fail", action: "edit" },
  insufficient_balance: { tone: "warn", action: "usage" },
  video_tasks_limit: { tone: "fail", action: "retry" },
  unknown_submit: { tone: "warn", action: "usage" },
  ingest_failed: { tone: "fail", action: "retry" },
  gateway_unavailable: { tone: "fail", action: "retry" },
};
/** §3.3: title/copy come from chatGen.errors.<code>.{title,body}. */
export function errorCard(code: string): ErrorCard {
  const known = ERROR_CARDS[code] ? code : "upstream_error";
  return { code: known, ...ERROR_CARDS[known] };
}

export interface MediaMeta {
  kind?: string;
  model?: string;
  aspect?: string;
  size?: string;
  count?: number;
  taskIds?: number[];
  taskId?: number;
  batch?: number;
  index?: number;
}
export function mediaOf(data: Readonly<Record<string, unknown>> | undefined): MediaMeta | null {
  const m = data?.media;
  return m && typeof m === "object" ? (m as MediaMeta) : null;
}

/**
 * Result messages of one request share a batch; the first one renders the
 * whole grid (returns all ids), the others render nothing (empty list).
 */
export function batchLead(items: readonly { id: string; data?: Readonly<Record<string, unknown>> }[], id: string): string[] {
  const me = items.find((i) => i.id === id);
  const batch = mediaOf(me?.data)?.batch;
  if (batch === undefined) return [];
  const same = items.filter((i) => mediaOf(i.data)?.batch === batch);
  return same[0]?.id === id ? same.map((i) => i.id) : [];
}

/** The prompt echoed in a result body (「…」 after 提示词：). */
export function promptOf(content: string): string {
  return /提示词：「([\s\S]*?)」/.exec(content)?.[1] ?? "";
}

/** A legacy carrier takes no chat follow-up server-side: its composer is image-only. */
export const forcedImageMode = (conv: { mode?: string } | null | undefined): boolean => conv?.mode === "media";

/**
 * Succeeded tasks the list returned without a signed link (Core signs
 * downloadUrl only on GET /generations/{id}); the result card needs one.
 */
export const unsignedDone = (tasks: readonly { id: number; status: string; downloadUrl?: string }[]): number[] =>
  tasks.filter((x) => x.status === "succeeded" && !x.downloadUrl).map((x) => x.id);

type SaveEnv = {
  fetch: (url: string) => Promise<Response>;
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
  click: (href: string, download: string) => void;
  open: (url: string) => void;
};
const browserEnv = (): SaveEnv => ({
  fetch: (u) => fetch(u),
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
  click: (href, download) => { const a = document.createElement("a"); a.href = href; a.download = download; a.click(); },
  open: (u) => { window.open(u, "_blank", "noopener,noreferrer"); },
});

/**
 * `<a download>` is ignored for cross-origin links, so a direct anchor to the signed CDN
 * URL navigates the (iframe) page to the raw image. Save via a same-origin blob instead;
 * without CORS fall back to a new tab (same as AttachmentChips).
 */
export async function saveImage(url: string, name: string, env: SaveEnv = browserEnv()): Promise<void> {
  let blob: Blob;
  try {
    const res = await env.fetch(url);
    if (!res.ok) throw new Error(`download returned ${res.status}`);
    blob = await res.blob();
  } catch {
    env.open(url);
    return;
  }
  const href = env.createObjectURL(blob);
  try { env.click(href, name); } finally { setTimeout(() => env.revokeObjectURL(href), 0); }
}
