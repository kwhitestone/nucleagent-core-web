import { useEffect, useState } from "react";
import { getGeneration } from "../addons/conversation/api/media";
import { mediaTaskView } from "./mediaPolicy";
import type { MediaPartData } from "./threadMessages";
import type { Translate } from "./ChatApp";

export function MediaCard({ data, t }: { data: MediaPartData; t: Translate }) {
  const taskId = data.media.taskId;
  const [revision, setRevision] = useState(0);
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
    let polls = 0;
    setResult(undefined); setError(false);
    const read = async () => {
      try {
        const view = await readTask();
        if (!live) return;
        setResult({ id: taskId!, view });
        if (view.pending && ++polls < 20) timer = setTimeout(read, 3000);
      } catch { if (live) setError(true); }
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [taskId, data.media.kind, revision]);
  const view = result?.id === taskId ? result?.view : undefined;
  const failed = error || view?.status === "unavailable";
  const label = failed ? "chatReact.mediaReadFailed" : view ? view.pending ? `chatReact.media_${view.status}` : `generate.status.${view.status}` : "chatReact.loading";
  const retry = () => setRevision((value) => value + 1);
  const download = async () => {
    try {
      const { url } = await readTask();
      if (!url) throw 0;
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = ""; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch { setError(true); }
  };
  return <div className="mc-media-card">
    <p role="status">{t(label, { reason: view?.reason || t("chatReact.mediaFailed") })}</p>
    {data.prompt && <p className="mc-media-prompt">{data.prompt}</p>}
    {!failed && view?.url && (data.media.kind === "video"
      ? <video className="mc-media" src={view.url} controls preload="metadata" onError={() => setError(true)} />
      : <a href={view.url} target="_blank" rel="noopener noreferrer"><img className="mc-media" src={view.url} alt={data.prompt} onError={() => setError(true)} /></a>)}
    {!failed && view?.url && <button type="button" className="mc-pill" onClick={download}>{t("common.attachmentDownload")}</button>}
    <button type="button" className="mc-pill" onClick={retry}>{t("chatReact.mediaRefresh")}</button>
  </div>;
}
