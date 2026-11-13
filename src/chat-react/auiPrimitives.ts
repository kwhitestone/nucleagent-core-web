/**
 * Only the assistant-ui primitives the island renders, imported per file (bundle budget, plan §9 / U5).
 * shortcut: deep dist paths bypass the package exports map; valid for the exactly pinned 0.15.36,
 * re-check these paths (or switch back to the namespace imports) on any aui upgrade.
 */
import { ThreadPrimitiveRoot } from "@aui-dist/primitives/thread/ThreadRoot.js";
import { ThreadPrimitiveViewport } from "@aui-dist/primitives/thread/ThreadViewport.js";
import { ThreadPrimitiveMessages } from "@aui-dist/primitives/thread/ThreadMessages.js";
import { ComposerPrimitiveRoot } from "@aui-dist/primitives/composer/ComposerRoot.js";
import { ComposerPrimitiveInput } from "@aui-dist/primitives/composer/ComposerInput.js";
import { ComposerPrimitiveSend } from "@aui-dist/primitives/composer/ComposerSend.js";
import { ComposerPrimitiveCancel } from "@aui-dist/primitives/composer/ComposerCancel.js";
import { ComposerPrimitiveAddAttachment } from "@aui-dist/primitives/composer/ComposerAddAttachment.js";
import { ComposerPrimitiveAttachments } from "@aui-dist/primitives/composer/ComposerAttachments.js";
import { ComposerPrimitiveQueue } from "@aui-dist/primitives/composer/ComposerQueue.js";
import { QueueItemPrimitiveText } from "@aui-dist/primitives/queueItem/QueueItemText.js";
import { QueueItemPrimitiveRemove } from "@aui-dist/primitives/queueItem/QueueItemRemove.js";
import { AttachmentPrimitiveRoot } from "@aui-dist/primitives/attachment/AttachmentRoot.js";
import { AttachmentPrimitiveRemove } from "@aui-dist/primitives/attachment/AttachmentRemove.js";
import { MessagePrimitiveRoot } from "@aui-dist/primitives/message/MessageRoot.js";
import { MessagePrimitiveParts } from "@aui-dist/primitives/message/MessageParts.js";

export const ThreadPrimitive = { Root: ThreadPrimitiveRoot, Viewport: ThreadPrimitiveViewport, Messages: ThreadPrimitiveMessages };
export const ComposerPrimitive = {
  Root: ComposerPrimitiveRoot, Input: ComposerPrimitiveInput, Send: ComposerPrimitiveSend, Cancel: ComposerPrimitiveCancel,
  AddAttachment: ComposerPrimitiveAddAttachment, Attachments: ComposerPrimitiveAttachments, Queue: ComposerPrimitiveQueue,
};
export const AttachmentPrimitive = { Root: AttachmentPrimitiveRoot, Remove: AttachmentPrimitiveRemove };
export const MessagePrimitive = { Root: MessagePrimitiveRoot, Parts: MessagePrimitiveParts };
export const QueueItemPrimitive = { Text: QueueItemPrimitiveText, Remove: QueueItemPrimitiveRemove };
