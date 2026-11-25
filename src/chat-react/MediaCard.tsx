import { useEffect, useState } from "react";
import { getGeneration } from "../addons/conversation/api/media";
import { mediaTaskView } from "./mediaPolicy";
import type { MediaPartData } from "./threadMessages";
import type { Translate } from "./ChatApp";
import { TurnUsage } from "./TurnUsage";
import type { TurnUsageView } from "./turnUsage";

/** MUYU-409: a running task is re-read by itself: 3 s growing ×1.5 up to 20 s, at most 30 reads (~9 min); remount starts over. */
export const MEDIA_POLL_READS = 30;

export function MediaCard({ data, t, usage, locale }: { data: MediaPartData; t: Translate; usage?: TurnUsageView; locale?: string }) {
  const taskId = data.media.taskId;
  const [result, setResult] = useState<{ id: number; view: ReturnType<typeof mediaTaskView> }>();
  const [error, setError] = useState(false);
  const readTask = async () => {
    if (!Number.isSafeInteger(taskId) || taskId! <= 0) throw new Error("invalid task");
    const task = await getGeneration(taskId!);
    if (task.id !== taskId || task.kind !== data.media.kind) throw new Error("invalid media");
    return mediaTaskView(task);
  };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0, wait = 3000;
    setResult(undefined); setError(false);
    const read = async () => {
      try {
        const view = await readTask();
        if (!live) return;
        setResult({ id: taskId!, view });
        if (view.pending && ++polls < MEDIA_POLL_READS) timer = setTimeout(read, wait = Math.min(wait * 1.5, 20000));
      } catch { if (live) setError(true); }
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [taskId, data.media.kind]);
  const view = result?.id === taskId ? result?.view : undefined;
  const failed = error || view?.status === "unavailable";
  const label = failed ? "chatReact.mediaReadFailed" : view ? view.pending ? `chatReact.media_${view.status}` : `generate.status.${view.status}` : "chatReact.loading";
  const download = async () => {
    try {
      const { url } = await readTask();
      if (!url) throw 0;
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith(`${data.media.kind}/`)) throw new Error("invalid media content");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `media-${taskId}.${blob.type.split("/")[1].split(";")[0].replace("jpeg", "jpg")}`;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
    } catch { setError(true); }
  };
  return <div className="mc-media-card">
    <p role="status">{t(label, { reason: view?.reason || t("chatReact.mediaFailed") })}</p>
    {data.prompt && <p className="mc-media-prompt">{data.prompt}</p>}
    {!failed && view?.url && (data.media.kind === "video"
      ? <video className="mc-media" src={view.url} controls preload="metadata" onError={() => setError(true)} />
      : <a href={view.url} target="_blank" rel="noopener noreferrer"><img className="mc-media" src={view.url} alt={data.prompt} onError={() => setError(true)} /></a>)}
    {!failed && view?.url && <button type="button" className="mc-pill" onClick={download}>{t("common.attachmentDownload")}</button>}
    {usage && <TurnUsage t={t} locale={locale} usage={usage} />}
  </div>;
}
