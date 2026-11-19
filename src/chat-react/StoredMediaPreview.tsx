import { useEffect, useState } from "react";
import { SESSION_CHANGE_EVENT } from "../contracts/platform-runtime";
import { getDownloadUrl, getImageContent } from "../addons/conversation/api/storage";
import { readAudioBlob } from "./audioPlayback";
import type { FileChip } from "./attachments";
import type { Translate } from "./ChatApp";

export function StoredMediaPreview({ file, t }: { file: FileChip; t: Translate }) {
  const mime = file.mimeType ?? "";
  const image = /^image\/(jpeg|png|gif|webp)$/.test(mime);
  const audio = mime === "audio/wav" && !!file.sha256;
  const eligible = image || audio || mime === "video/mp4";
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState<string | null>("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const clear = () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSource("");
    };
    window.addEventListener(SESSION_CHANGE_EVENT, clear, { signal: controller.signal });
    if (eligible && (!audio || revision)) void (async () => {
      try {
        const value = audio ? { blob: await readAudioBlob(file, controller.signal, getDownloadUrl) }
          : image ? await getImageContent(file.id, controller.signal) : await getDownloadUrl(file.id);
        controller.signal.throwIfAborted();
        setSource(typeof value === "string" ? value : (objectUrl = URL.createObjectURL(value.blob)));
      } catch { if (!controller.signal.aborted) setSource(null); }
    })();
    return clear;
  }, [revision]);
  const failed = () => setSource(null);
  const Playback = audio ? "audio" : "video";
  return eligible && <span className="mc-preview">
    {source && (image ? <img className="mc-media" src={source} alt={file.name} onError={failed} />
      : <Playback className="mc-media" controls preload="metadata" src={source} aria-label={file.name} onError={failed} />)}
    {(!audio || !source) && <button type="button" className="mc-pill" disabled={audio && revision > 0 && source !== null} onClick={() => setRevision(value => value + 1)}>{t(`chatReact.${source === null ? "mediaReadFailed" : audio ? "audioPreview" : "mediaRefresh"}`)}</button>}
  </span>;
}
