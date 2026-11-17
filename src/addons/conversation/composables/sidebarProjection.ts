import type { Conversation } from "../api/types";
import { broadcastGroupId } from "./broadcastViewPolicy";

/**
 * One sidebar row as projected to the shell (`conversations` / `search-results`).
 * MUYU-410 adds `pinned` (false when an older Core does not send it); older shells ignore it.
 */
export function sidebarRow(c: Conversation) {
  return {
    id: c.id, title: c.title, status: c.status,
    broadcastGroupId: broadcastGroupId(c), executionBackend: c.executionBackend,
    pinned: c.pinned === true,
  };
}
