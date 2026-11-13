/**
 * Only the assistant-ui primitives the island renders, imported per file (bundle budget, plan §9 / U5).
 * shortcut: deep dist paths bypass the package exports map; valid for the exactly pinned 0.15.36,
 * re-check these paths (or switch back to the namespace imports) on any aui upgrade.
 */
import { ThreadPrimitiveRoot } from "@aui-dist/primitives/thread/ThreadRoot.js";
import { ThreadPrimitiveViewport } from "@aui-dist/primitives/thread/ThreadViewport.js";
import { ThreadPrimitiveViewportFooter } from "@aui-dist/primitives/thread/ThreadViewportFooter.js";
import { ThreadPrimitiveMessages } from "@aui-dist/primitives/thread/ThreadMessages.js";
import { ThreadPrimitiveEmpty } from "@aui-dist/primitives/thread/ThreadEmpty.js";
import { ThreadPrimitiveScrollToBottom } from "@aui-dist/primitives/thread/ThreadScrollToBottom.js";
import { ThreadPrimitiveLoadEarlier } from "@aui-dist/primitives/thread/ThreadLoadEarlier.js";
import { ThreadPrimitiveSuggestions } from "@aui-dist/primitives/thread/ThreadSuggestions.js";
import { SuggestionPrimitiveTitle } from "@aui-dist/primitives/suggestion/SuggestionTitle.js";
import { SuggestionPrimitiveDescription } from "@aui-dist/primitives/suggestion/SuggestionDescription.js";
import { SuggestionPrimitiveTrigger } from "@aui-dist/primitives/suggestion/SuggestionTrigger.js";
import { ComposerPrimitiveRoot } from "@aui-dist/primitives/composer/ComposerRoot.js";
import { ComposerPrimitiveInput } from "@aui-dist/primitives/composer/ComposerInput.js";
import { ComposerPrimitiveSend } from "@aui-dist/primitives/composer/ComposerSend.js";
import { ComposerPrimitiveCancel } from "@aui-dist/primitives/composer/ComposerCancel.js";
import { ComposerPrimitiveAddAttachment } from "@aui-dist/primitives/composer/ComposerAddAttachment.js";
import { ComposerPrimitiveAttachments } from "@aui-dist/primitives/composer/ComposerAttachments.js";
import { ComposerPrimitiveAttachmentDropzone } from "@aui-dist/primitives/composer/ComposerAttachmentDropzone.js";
import { ComposerPrimitiveQueue } from "@aui-dist/primitives/composer/ComposerQueue.js";
import { QueueItemPrimitiveText } from "@aui-dist/primitives/queueItem/QueueItemText.js";
import { QueueItemPrimitiveRemove } from "@aui-dist/primitives/queueItem/QueueItemRemove.js";
import { AttachmentPrimitiveRoot } from "@aui-dist/primitives/attachment/AttachmentRoot.js";
import { AttachmentPrimitiveName } from "@aui-dist/primitives/attachment/AttachmentName.js";
import { AttachmentPrimitiveRemove } from "@aui-dist/primitives/attachment/AttachmentRemove.js";
import { MessagePrimitiveRoot } from "@aui-dist/primitives/message/MessageRoot.js";
import { MessagePrimitiveAttachments } from "@aui-dist/primitives/message/MessageAttachments.js";
import { ActionBarPrimitiveRoot } from "@aui-dist/primitives/actionBar/ActionBarRoot.js";
import { ActionBarPrimitiveReload } from "@aui-dist/primitives/actionBar/ActionBarReload.js";
import { MessagePrimitiveGroupedParts } from "@assistant-ui/core/react";

export const ThreadPrimitive = {
  Root: ThreadPrimitiveRoot, Viewport: ThreadPrimitiveViewport, ViewportFooter: ThreadPrimitiveViewportFooter,
  Messages: ThreadPrimitiveMessages, Empty: ThreadPrimitiveEmpty, ScrollToBottom: ThreadPrimitiveScrollToBottom,
  LoadEarlier: ThreadPrimitiveLoadEarlier, Suggestions: ThreadPrimitiveSuggestions,
};
export const SuggestionPrimitive = { Title: SuggestionPrimitiveTitle, Description: SuggestionPrimitiveDescription, Trigger: SuggestionPrimitiveTrigger };
export const ComposerPrimitive = {
  Root: ComposerPrimitiveRoot, Input: ComposerPrimitiveInput, Send: ComposerPrimitiveSend, Cancel: ComposerPrimitiveCancel,
  AddAttachment: ComposerPrimitiveAddAttachment, Attachments: ComposerPrimitiveAttachments,
  AttachmentDropzone: ComposerPrimitiveAttachmentDropzone, Queue: ComposerPrimitiveQueue,
};
export const AttachmentPrimitive = { Root: AttachmentPrimitiveRoot, Name: AttachmentPrimitiveName, Remove: AttachmentPrimitiveRemove };
export const MessagePrimitive = { Root: MessagePrimitiveRoot, GroupedParts: MessagePrimitiveGroupedParts, Attachments: MessagePrimitiveAttachments };
export const ActionBarPrimitive = { Root: ActionBarPrimitiveRoot, Reload: ActionBarPrimitiveReload };
export const QueueItemPrimitive = { Text: QueueItemPrimitiveText, Remove: QueueItemPrimitiveRemove };
