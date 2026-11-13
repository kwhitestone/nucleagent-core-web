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
import { MessagePrimitiveRoot } from "@aui-dist/primitives/message/MessageRoot.js";
import { MessagePrimitiveParts } from "@aui-dist/primitives/message/MessageParts.js";

export const ThreadPrimitive = { Root: ThreadPrimitiveRoot, Viewport: ThreadPrimitiveViewport, Messages: ThreadPrimitiveMessages };
export const ComposerPrimitive = { Root: ComposerPrimitiveRoot, Input: ComposerPrimitiveInput, Send: ComposerPrimitiveSend, Cancel: ComposerPrimitiveCancel };
export const MessagePrimitive = { Root: MessagePrimitiveRoot, Parts: MessagePrimitiveParts };
