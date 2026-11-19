import { useEffect, useState } from "react";
import { SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { getDownloadUrl, getImageContent } from "../addons/conversation/api/storage";
import type { FileChip } from "./attachments";
import type { Translate } from "./ChatApp";

export function StoredMediaPreview({ file, t }: { file: FileChip; t: Translate }) {
  const image = /^image\/(jpeg|png|gif|webp)$/.test(file.mimeType ?? "");
  const eligible = file.verified && (image || /^video\/(mp4|webm)$/.test(file.mimeType ?? ""));
  const key = `${file.id}:${file.mimeType}:${file.sha256}:${eligible}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState({ key: "", url: "", failed: false });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    const clear = () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setResult({ key, url: "", failed: false });
    };
    setResult({ key, url: "", failed: false });
    window.addEventListener(SESSION_CHANGE_EVENT, clear);
    if (eligible) void (async () => {
      try {
        const value = image ? await getImageContent(file.id, controller.signal) : await getDownloadUrl(file.id);
        controller.signal.throwIfAborted();
        const url = typeof value === "string" ? value : (objectUrl = URL.createObjectURL(value.blob));
        setResult({ key, url, failed: false });
      } catch { if (!controller.signal.aborted) setResult({ key, url: "", failed: true }); }
    })();
    return () => { clear(); window.removeEventListener(SESSION_CHANGE_EVENT, clear); };
  }, [key, revision]);
  if (!eligible) return null;
  const current = result.key === key ? result : undefined;
  const failed = () => setResult({ key, url: "", failed: true });
  return <span className="mc-stored-media">
    {current?.url && (image ? <img className="mc-media" src={current.url} alt={file.name} onError={failed} />
      : <video className="mc-media" src={current.url} controls preload="metadata" aria-label={file.name} onError={failed} />)}
    {current?.failed && <span role="alert">{t("common.attachmentDownloadFailed")}</span>}
    <button type="button" className="mc-pill" data-testid="mc-media-refresh" onClick={() => setRevision(value => value + 1)}>{t("chatReact.mediaRefresh")}</button>
  </span>;
}
