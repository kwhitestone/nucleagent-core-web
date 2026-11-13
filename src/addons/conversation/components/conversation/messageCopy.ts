import { sessionRequestSignal } from "@/addons/platform-api/session/embeddedSession";
import { revalidating } from "@/addons/platform-api/session/embeddedAuthorization";

export type CopyState = "" | "copied" | "error";

/**
 * Copy the raw body (no Markdown rendering) under the business session: nothing is copied while the
 * session revalidates, and a result that lands after sign-out/renewal or after the caller moved on
 * (`stillCurrent` false) reports nothing. Shared by MessageItem.vue and the React chat island.
 */
export async function copyRawBody(content: string, stillCurrent: () => boolean): Promise<CopyState | undefined> {
  if (!content || revalidating.value) return undefined;
  const signal = sessionRequestSignal("business");
  const current = () => stillCurrent() && !signal.aborted && !revalidating.value;
  try {
    await navigator.clipboard.writeText(content);
    return current() ? "copied" : undefined;
  } catch {
    return current() ? "error" : undefined;
  }
}

/** Local time to the second, as shown in the message header; "" for missing/invalid input. */
export function formatMessageTime(timestamp: string | undefined): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
