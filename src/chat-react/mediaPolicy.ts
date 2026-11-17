import { assertSafeDownloadUrl } from "../addons/conversation/api/downloadUrlPolicy.ts";

export function guardMediaSend<Args extends unknown[], Result>(media: { kind: "image" | "video" } | null | undefined, send: (...args: Args) => Promise<Result>, message: string) {
  return async (...args: Args): Promise<Result> => {
    if (media) throw new Error(message);
    return send(...args);
  };
}

export function mediaTaskView(task: { status: string; downloadUrl?: string }) {
  const pending = ["queued", "submitting", "running", "ingesting"].includes(task.status);
  const url = task.status === "succeeded" && task.downloadUrl ? assertSafeDownloadUrl(task.downloadUrl) : undefined;
  const status = pending || ["failed", "unknown", "cancelled"].includes(task.status) ? task.status : url ? "succeeded" : "unavailable";
  return { status, pending, url };
}
