import { openToolLink } from "@/addons/conversation/api/conversation";
import { assertSafeDownloadUrl, isSealedToolLink } from "@/addons/conversation/api/downloadUrlPolicy";
import { toast } from "@/composables/useToast";

/**
 * MUYU-181: tool links carry sealed tickets, never credentials; the owner's real link is fetched
 * from Core at click time and opened without ever entering the page. Same steps as
 * MarkdownContent.vue's onClick (kept separate so the default Vue chunk does not change size);
 * the conversation id comes from the nearest [data-conversation-key].
 */
export async function openSealedLinkOnClick(event: MouseEvent): Promise<void> {
  const anchor = (event.target as Element | null)?.closest?.("a");
  const href = anchor?.getAttribute("href") ?? "";
  const conversationId = anchor?.closest("[data-conversation-key]")?.getAttribute("data-conversation-key") ?? "";
  if (!isSealedToolLink(href) || !/^\d+$/.test(conversationId)) return;
  event.preventDefault();
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const link = assertSafeDownloadUrl(await openToolLink(conversationId, href));
    if (tab) tab.location.href = link;
    else window.open(link, "_blank", "noopener,noreferrer");
  } catch {
    tab?.close();
    toast.error("链接无法打开");
  }
}
