import type { AttachmentAdapter, PendingAttachment } from "@assistant-ui/react";
import { MAX_UPLOAD_BYTES, UploadError, getDownloadUrl, getImageContent, uploadFile } from "../addons/conversation/api/storage.ts";
import type { MessageAttachment } from "../addons/conversation/api/types.ts";
import type { ConversationAttachment } from "../addons/conversation/task-conversation/core/types.ts";

type Upload = (file: File, onProgress: (loaded: number, total: number) => void) => Promise<MessageAttachment>;

/**
 * assistant-ui AttachmentAdapter over the existing storage upload (presign → direct upload →
 * register, same path as AttachmentPicker.vue). Upload starts on pick, like the Vue picker; the
 * message only carries the storage reference (fileId/name/mime), never the file content: `content`
 * stays empty and the File is dropped once uploaded (plan §10: no inlined attachments).
 */
export function storageAttachmentAdapter(onError: (file: File, message: string) => void, upload: Upload = uploadFile): AttachmentAdapter {
  const uploaded = new Map<string, MessageAttachment>();
  return {
    accept: "*",
    async *add({ file }) {
      const base: PendingAttachment = {
        id: `${file.name}-${crypto.randomUUID()}`, type: file.type.startsWith("image/") ? "image" : "file",
        name: file.name, contentType: file.type || undefined, file,
        status: { type: "running", reason: "uploading", progress: 0 },
      };
      if (file.size > MAX_UPLOAD_BYTES) {
        const message = `文件超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`;
        onError(file, message);
        yield { ...base, status: { type: "incomplete", reason: "error", message } };
        return;
      }
      yield base;
      // Progress may fire at any time; keep the latest value and wake the loop to re-yield it.
      let latest: number | undefined;
      let wake = () => {};
      const done = upload(file, (loaded, total) => { latest = total > 0 ? loaded / total : 0; wake(); });
      let settled = false;
      void done.then(() => { settled = true; wake(); }, () => { settled = true; wake(); });
      try {
        while (!settled || latest !== undefined) {
          if (latest === undefined) await new Promise<void>((resolve) => { wake = resolve; });
          if (latest === undefined) continue;
          const progress = latest;
          latest = undefined;
          if (!settled) yield { ...base, status: { type: "running", reason: "uploading", progress } };
        }
        uploaded.set(base.id, await done);
        yield { ...base, status: { type: "requires-action", reason: "composer-send" } };
      } catch (error) {
        const message = error instanceof UploadError ? error.message : "上传失败";
        onError(file, message);
        yield { ...base, status: { type: "incomplete", reason: "error", message } };
      }
    },
    async remove(attachment) { uploaded.delete(attachment.id); },
    async send(attachment) {
      const stored = uploaded.get(attachment.id);
      if (!stored) throw new UploadError(`${attachment.name}: 附件未上传完成`);
      uploaded.delete(attachment.id);
      // The storage fileId becomes the attachment id; no File and no inline content travel on.
      return { id: stored.fileId, type: attachment.type, name: stored.name, contentType: stored.mimeType, status: { type: "complete" }, content: [] };
    },
  };
}

/** Composer attachments (already uploaded) → the controller's ConversationAttachment refs. */
export const toConversationAttachments = (attachments: readonly { id: string; name: string; contentType?: string }[] | undefined): ConversationAttachment[] =>
  (attachments ?? []).map((a) => ({ id: a.id, name: a.name, ...(a.contentType ? { mimeType: a.contentType } : {}) }));

/** Chip data for a stored file (sent attachment or produced file); `verified` = Storage confirmed it (download allowed). */
export interface FileChip { id: string; name: string; mimeType?: string; size?: number; verified: boolean }

export const toFileChip = (a: ConversationAttachment): FileChip => ({
  id: a.id, name: a.name, ...(a.mimeType ? { mimeType: a.mimeType } : {}), ...(a.size ? { size: a.size } : {}),
  verified: a.metadata?.verification === "verified",
});

const KINDS: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/, "image"],
  [/\.pdf$/, "pdf"],
  [/\.(docx?|rtf|odt|txt|md|pptx?|key)$/, "doc"],
  [/\.(xlsx?|csv|tsv|ods|numbers)$/, "sheet"],
  [/\.(js|ts|tsx|jsx|py|go|java|c|cpp|h|rs|rb|php|sh|json|ya?ml|xml|html|css|sql)$/, "code"],
  [/\.(zip|rar|7z|tar|gz|tgz|bz2)$/, "archive"],
  [/\.(mp4|mov|webm|avi|mkv|mp3|wav|m4a|flac)$/, "media"],
];
/** Icon kind for a file chip: the MIME image type wins, then the extension, else a plain file. */
export function fileKind(name: string, mimeType?: string): string {
  if (mimeType?.toLowerCase().startsWith("image/")) return "image";
  const lower = name.toLowerCase();
  return KINDS.find(([re]) => re.test(lower))?.[1] ?? "file";
}

function save(href: string, filename: string) {
  const anchor = Object.assign(document.createElement("a"), { href, download: filename, style: "display:none" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Same download path as AttachmentChips.vue: images from verified Storage bytes, other files through
 * the validated signed URL (blob download, or a new no-opener tab when the CDN has no CORS).
 * shortcut: a copy of AttachmentChips.vue's download(); share one module if either side changes.
 */
export async function downloadFile(file: FileChip): Promise<void> {
  if (fileKind(file.name, file.mimeType) === "image") {
    const { blob, filename } = await getImageContent(file.id);
    const url = URL.createObjectURL(blob);
    try { save(url, filename); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    return;
  }
  const url = await getDownloadUrl(file.id);
  let objectUrl = "";
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download returned ${response.status}`);
    objectUrl = URL.createObjectURL(await response.blob());
    save(objectUrl, file.name || "attachment");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  } finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/**
 * Same output as attachmentPresentation.formatAttachmentSize; a local copy because importing that module
 * from the island re-splits the default /c/:id chunks (+~70 B over the 1 KiB budget, leg 6 §20).
 */
export function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
