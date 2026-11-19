import { useEffect, useState } from "react";
import { listOwnedFiles, type OwnedFile } from "../addons/conversation/api/ownedFiles";

export function AudioFilePicker({ value, onChange, disabled, image = false, label }: { value: string; onChange: (value: string) => void; disabled: boolean; image?: boolean; label?: string }) {
  const title = image ? label === "last_frame_url" ? "尾帧图片" : "首帧图片" : "音频文件";
  const reason = (file: OwnedFile) => file.status !== "active" ? "不可用"
    : !(image ? ["image/png", "image/jpeg"] : ["audio/wav"]).includes(file.mimeType) ? (image ? "仅支持 PNG/JPEG" : "仅支持 WAV")
    : file.size <= 0 || file.size > (image ? 4700000 : 1048576) ? (image ? "须非空且≤4.7 MB" : "须非空且≤1 MiB") : "";
  const [page, setPage] = useState<{ items: OwnedFile[]; hasMore: boolean } | null>();
  const [cursor, setCursor] = useState({ offset: 0 });
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const reset = () => { live = false; controller.abort(); onChange(""); setPage(undefined); setCursor({ offset: 0 }); };
    window.addEventListener("nucleagent:session-change", reset);
    setPage(undefined);
    void listOwnedFiles(cursor.offset, controller.signal).then(page => { if (live) setPage(page); }).catch(() => { if (live) setPage(null); });
    return () => { live = false; controller.abort(); window.removeEventListener("nucleagent:session-change", reset); };
  }, [cursor]);
  const refresh = (offset: number) => { onChange(""); setPage(undefined); setCursor({ offset }); };
  return <div>
    <label>{title} *
      <select aria-label={title} required disabled={disabled || !page} value={image ? value.slice(14) : value} onChange={(event) => {
        const file = page?.items.find(file => file.fileId === event.target.value);
        onChange(file && !reason(file) ? (image ? "storage-image:" : "") + file.fileId : "");
      }}>
        <option value="">请选择文件</option>
        {page?.items.map(file => <option key={file.fileId} value={file.fileId} disabled={!!reason(file)}>
          {`${file.origName} · ${file.mimeType} · ${file.size} bytes ${reason(file)}`}
        </option>)}
      </select>
    </label>
    {page === undefined && <p role="status">加载中</p>}
    {page === null && <p role="alert">读取失败</p>}
    {page && !page.items.length && <p role="status">{image ? "请上传PNG/JPEG（≤4.7 MB）" : "暂无文件：附件上传WAV（≤1 MiB）"}</p>}
    <button type="button" disabled={disabled} onClick={() => refresh(0)}>刷新</button>
    {[-50, 50].map(step => (step < 0 ? cursor.offset > 0 : page?.hasMore) && <button key={step} type="button" disabled={disabled || !page} onClick={() => refresh(cursor.offset + step)}>{step < 0 ? "上一页" : "下一页"}</button>)}
  </div>;
}
