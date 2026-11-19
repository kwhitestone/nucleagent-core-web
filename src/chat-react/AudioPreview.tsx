import { useEffect, useRef, useState } from "react";
import { SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { getDownloadUrl } from "../addons/conversation/api/storage";
import type { FileChip } from "./attachments";
import { readAudioBlob } from "./audioPlayback";
import type { Translate } from "./ChatApp";

export function AudioPreview({ file, t }: { file: FileChip; t: Translate }) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef<{ controller: AbortController; url: string } | undefined>(undefined);
  useEffect(() => {
    const current = { controller: new AbortController(), url: "" };
    active.current = current;
    setSource(""); setBusy(false); setFailed(false);
    const clear = () => { current.controller.abort(); if (current.url) URL.revokeObjectURL(current.url); setSource(""); };
    window.addEventListener(SESSION_CHANGE_EVENT, clear);
    return () => { clear(); window.removeEventListener(SESSION_CHANGE_EVENT, clear); };
  }, [file.id, file.sha256, file.verified]);
  const load = async () => {
    const current = active.current;
    if (!current || current.controller.signal.aborted || busy || source) return;
    setBusy(true); setFailed(false);
    try {
      const blob = await readAudioBlob(file, current.controller.signal, getDownloadUrl);
      current.controller.signal.throwIfAborted();
      current.url = URL.createObjectURL(blob); setSource(current.url);
    } catch { if (!current.controller.signal.aborted) setFailed(true); }
    finally { if (!current.controller.signal.aborted) setBusy(false); }
  };
  if (!file.verified || file.mimeType !== "audio/wav" || !file.sha256) return null;
  return <span>
    {source ? <audio controls preload="metadata" src={source} aria-label={file.name} /> : <button type="button" className="mc-pill" disabled={busy} onClick={load}>{t("chatReact.audioPreview")}</button>}
    {failed && <span role="alert">{t("common.attachmentDownloadFailed")}</span>}
  </span>;
}
