import { useEffect, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { listOwnedFiles } from "../addons/conversation/api/ownedFiles";
import { MAX_ATTACHMENTS } from "../addons/conversation/task-conversation/core";
import type { Translate } from "./ChatApp";

export function CloudFiles({ t, close }: { t: Translate; close(): void }) {
  const aui = useAui();
  const attachments = useAuiState(state => state.composer.attachments);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Awaited<ReturnType<typeof listOwnedFiles>> | null>();
  useEffect(() => {
    const controller = new AbortController();
    setPage(undefined);
    listOwnedFiles(offset, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }, () => { if (!controller.signal.aborted) setPage(null); });
    return () => controller.abort();
  }, [offset]);
  const files = page?.items.filter(file => file.status === "active");
  return <>
    {files?.map(file => <button type="button" role="menuitem" className="mc-menu-item" key={file.fileId}
      disabled={attachments.length >= MAX_ATTACHMENTS || attachments.some(a => a.id === file.fileId)}
      onClick={async () => {
        await aui.composer().addAttachment({ id: file.fileId, name: file.origName, contentType: file.mimeType,
          type: file.mimeType.startsWith("image/") ? "image" : "file", content: [] });
        close();
      }}>{file.origName}</button>)}
    {!files?.length && <p role="status">{t(page === null ? "common.operationFailed" : page ? "chatReact.noResults" : "chatReact.loading")}</p>}
    {offset > 0 && <button type="button" role="menuitem" onClick={() => setOffset(offset - 50)}>←</button>}
    {page?.hasMore && <button type="button" role="menuitem" onClick={() => setOffset(offset + 50)}>→</button>}
  </>;
}
