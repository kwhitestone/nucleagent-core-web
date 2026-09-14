import type { MessageAttachment } from "@/addons/conversation/api/types";
import type { ConversationAttachment } from "@/addons/conversation/task-conversation/core";

/** Map protocol attachments to the storage-aware presentation shape. */
export function toMessageAttachment(
  attachment: ConversationAttachment,
): MessageAttachment {
  const rawKind = attachment.metadata?.kind;
  const kind =
    rawKind === "image" || rawKind === "pdf" || rawKind === "file"
      ? rawKind
      : undefined;
  return {
    fileId: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(kind ? { kind } : {}),
  };
}

/** Recognize canonical image attachments and legacy rows that only have MIME metadata. */
export function isImageAttachment(attachment: MessageAttachment): boolean {
  if (attachment.kind) return attachment.kind === "image";
  return attachment.mimeType?.toLowerCase().startsWith("image/") ?? false;
}

/** Human-readable attachment size shared by chips and image cards. */
export function formatAttachmentSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
