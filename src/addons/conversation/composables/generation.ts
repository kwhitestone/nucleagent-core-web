// MT3-coreweb: pure logic of the generate page (/generate/:kind). Relative
// imports only: loaded natively by node --test (coverage-gated in test:unit).
// Core contract: app/src/server/addons/media (core 9c0c74a).
import { ApiError } from "../../../contracts/platform-runtime.ts";
import { modelErrorMessage } from "./modelErrorMessage.ts";

type Translate = (key: string, named?: Record<string, unknown>) => string;

export type GenerationKind = "image" | "video";

/** The two home cards that open the generate page; every other card keeps prefilling. */
export function generationKind(card: { id: string }): GenerationKind | null {
  if (card.id === "generateImage") return "image";
  if (card.id === "generateVideo") return "video";
  return null;
}

export const PROMPT_MAX = 2000;
export const PENDING = ["queued", "submitting", "running", "ingesting"] as const;
export const STATUSES = [...PENDING, "succeeded", "failed", "unknown"] as const;
export const ERROR_CODES = [
  "insufficient_balance", "content_rejected", "upstream_timeout", "upstream_error",
  "unknown_submit", "ingest_failed", "gateway_unavailable", "media_busy",
] as const;

/** `GET /generations/{id}` and list item (Core MediaTaskView). */
export interface GenerationTask {
  id: number;
  kind: string;
  model: string;
  prompt: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  conversationId: number;
  file?: { id: string; name: string; mime: string; size: number };
  downloadUrl?: string;
  createdAt: string;
  finishedAt?: string;
}

/** `GET /models?kind=` item. */
export interface MediaModel {
  providerId: number;
  model: string;
  kind: string;
  verified: boolean;
}

export const isPending = (status: string): boolean => (PENDING as readonly string[]).includes(status);

/**
 * Text for an error code. Known codes use the i18n copy (media_busy with the
 * caller's in-flight count); anything else uses the server's localized message,
 * then the generic upstream text.
 */
export function errorText(code: string, t: Translate, fallback = "", busy = 0): string {
  if ((ERROR_CODES as readonly string[]).includes(code)) return t(`generate.errors.${code}`, { n: busy });
  return fallback || t("generate.errors.upstream_error");
}

export interface StatusView {
  label: string;
  pending: boolean;
  preview: boolean;
  download: boolean;
  regenerate: boolean;
}

/**
 * How one task is shown. unknown is never "failed" and never offers a quick
 * resubmit (the charge may already have happened); failed has no preview or
 * download.
 */
export function statusView(task: Pick<GenerationTask, "kind" | "status" | "errorCode" | "errorMessage" | "file">, t: Translate): StatusView {
  if (isPending(task.status)) {
    const base = t(`generate.status.${task.status}`);
    return { label: task.kind === "video" ? `${base} · ${t("generate.videoHint")}` : base, pending: true, preview: false, download: false, regenerate: false };
  }
  if (task.status === "succeeded") {
    const has = !!task.file;
    return { label: t("generate.status.succeeded"), pending: false, preview: has, download: has, regenerate: true };
  }
  if (task.status === "failed") {
    const reason = errorText(task.errorCode ?? "", t, task.errorMessage);
    return { label: t("generate.status.failed", { reason }), pending: false, preview: false, download: false, regenerate: true };
  }
  return { label: t("generate.status.unknown"), pending: false, preview: false, download: false, regenerate: false };
}

/** Poll delay: 3 s for the first minute, then 10 s; null while the page is hidden. */
export function nextPollDelay(elapsedMs: number, hidden: boolean): number | null {
  if (hidden) return null;
  return elapsedMs < 60_000 ? 3_000 : 10_000;
}

/** Dropdown keys "{providerId}:{model}": `/media/models?kind=` entries of this kind only. */
export function mediaChoiceKeys(models: MediaModel[], kind: string): string[] {
  return models.filter((m) => m.kind === kind).map((m) => `${m.providerId}:${m.model}`);
}

/** Preselect the verified model, else the first one. */
export function defaultMediaModel(models: MediaModel[], kind: string): { providerId: number; model: string } | null {
  const list = models.filter((m) => m.kind === kind);
  const pick = list.find((m) => m.verified) ?? list[0];
  return pick ? { providerId: pick.providerId, model: pick.model } : null;
}

export const promptValid = (prompt: string): boolean => {
  const n = [...prompt.trim()].length;
  return n >= 1 && n <= PROMPT_MAX;
};

/** A `mode=media` carrier conversation takes no follow-ups: the page owns regeneration. */
export function conversationAcceptsInput(conv: { mode?: string } | null | undefined): boolean {
  return conv?.mode !== "media";
}

/** Kind of a carrier conversation by its model; video only when the video list knows it. */
export function conversationMediaKind(model: string | undefined, videoModels: string[] | null): GenerationKind {
  return model && videoModels?.includes(model) ? "video" : "image";
}

/** One POST in flight at a time: a second click while busy returns null without a request. */
export function createSubmitter<B, R>(post: (body: B) => Promise<R>, state: { busy: boolean } = { busy: false }) {
  return {
    state,
    async submit(body: B): Promise<R | null> {
      if (state.busy) return null;
      state.busy = true;
      try {
        return await post(body);
      } finally {
        state.busy = false;
      }
    },
  };
}

/**
 * Submit error text: 400 model_type_mismatch → modelErrorMessage (MT2), the 8
 * known codes → i18n (429 with the caller's in-flight count), else the server text.
 */
export function submitErrorText(error: unknown, t: Translate, busy: number): string {
  if (error instanceof ApiError && error.code !== "model_type_mismatch" && (ERROR_CODES as readonly string[]).includes(error.code)) {
    return errorText(error.code, t, error.message, busy);
  }
  return modelErrorMessage(error, t);
}

/** Notes beside dropdown entries: unverified models. */
export function mediaNotes(models: MediaModel[], kind: string, label: string): Record<string, string> {
  return Object.fromEntries(models.filter((m) => m.kind === kind && !m.verified).map((m) => [`${m.providerId}:${m.model}`, label]));
}

/** The server list is the truth (own tasks only); fresher polled rows replace their entries. */
export function mergeTasks<T extends { id: number }>(server: T[], polled: T[]): T[] {
  const byId = new Map(polled.map((p) => [p.id, p]));
  return server.map((s) => byId.get(s.id) ?? s);
}

/**
 * Poll loop for unfinished tasks. `tick` polls and returns whether anything is
 * still pending; the loop schedules itself by nextPollDelay, pauses while
 * hidden (visibility() resumes) and ends for good on stop().
 */
export function createPoller(o: {
  now: () => number;
  hidden: () => boolean;
  tick: () => Promise<boolean>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}) {
  let started = 0;
  let handle: unknown = null;
  let running = false;
  let stopped = false;
  const clear = () => { if (handle !== null) o.clearTimer(handle); handle = null; };
  const schedule = () => {
    clear();
    if (stopped) return;
    const delay = nextPollDelay(o.now() - started, o.hidden());
    if (delay === null) return;
    handle = o.setTimer(async () => {
      handle = null;
      if (stopped || running) return;
      running = true;
      let more = false;
      try {
        more = await o.tick();
      } catch {
        more = true; // a failed poll retries on the next beat
      } finally {
        running = false;
      }
      if (more) schedule();
    }, delay);
  };
  return {
    /** (Re)start for newly pending tasks; the 3 s → 10 s clock restarts. */
    start() { stopped = false; started = o.now(); schedule(); },
    visibility() { if (!stopped && !running) schedule(); },
    stop() { stopped = true; clear(); },
  };
}

/** In-flight count for the 429 text: pending tasks, plus unknown ones from the last 30 min (Core counts those too). */
export function inFlightCount(tasks: Pick<GenerationTask, "status" | "createdAt">[], now: number): number {
  return tasks.filter((t) => isPending(t.status) || (t.status === "unknown" && now - Date.parse(t.createdAt) < 30 * 60_000)).length;
}
