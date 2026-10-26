/**
 * All users' conversations (admin, read-only) — core addons/admin/router/conversations_admin.go.
 *
 *   GET /api/v1/addons/admin/conversations?type=chat|im&userId&from&to&includeDeleted&limit&cursor
 *   GET /api/v1/addons/admin/conversations/:type/:id
 *   GET /api/v1/addons/admin/conversations/:type/:id/messages?limit&cursor
 *   GET /api/v1/addons/admin/conversations/:type/:id/attachments?limit&cursor
 *
 * The backend requires core:admin:read AND core:conversation:admin-read on every
 * call and audits each one; hiding the tab here is presentation only.
 */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Envelope } from "./admin";

const http = () => getPlatformRuntime().http;
export const CONVERSATIONS_BASE = "/api/v1/addons/admin/conversations";
export const CONVERSATION_VIEWER_PERMISSION = "core:conversation:admin-read";

export type ConversationType = "chat" | "im";

export interface ConversationUser {
  id: number;
  username: string;
  nickName: string;
  accountType: string;
  isActive: boolean;
}

export interface ConversationRow {
  type: ConversationType;
  id: number;
  userId: number;
  user?: ConversationUser;
  title?: string;
  status?: string;
  processing: boolean;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  mode?: string;
  model?: string;
  executionBackend?: string;
  imLinked?: boolean;
  channelType?: number;
  channelKey?: string;
  peerUserId?: number;
  peer?: ConversationUser;
  groupTitle?: string;
  lastMessageAt?: string;
  hidden?: boolean;
}

export interface ConversationLink {
  coreConversationId: number;
  coreStatus?: string;
  coreTitle?: string;
  channelType: number;
  channelKey: string;
  agentUserId: number;
  executionOwnerUserId: number;
  imConversationId?: number;
}

export interface ConversationDetail extends ConversationRow {
  messageCount: number;
  streamingCount: number;
  inFlightCount: number;
  links: ConversationLink[];
  linkStatus: "ok" | "unavailable";
}

export interface ConversationAttachment {
  messageId: number;
  fileId?: string;
  name: string;
  mimeType?: string;
  size?: number;
  kind?: string;
}

export interface ConversationMessage {
  id: number;
  senderType?: string;
  senderName?: string;
  fromUserId?: number;
  from?: ConversationUser;
  msgType?: string;
  payloadType?: number;
  content: string;
  streaming: boolean;
  thinking?: boolean;
  contentHidden?: boolean;
  attachments?: ConversationAttachment[];
  createdAt: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string;
  hasMore: boolean;
}

export interface ConversationFilters {
  type: ConversationType;
  userId?: string;
  from?: string;
  to?: string;
  includeDeleted?: boolean;
}

type PageEnvelope<T> = Envelope<T[]> & { nextCursor?: string; hasMore?: boolean };

function page<T>(body: PageEnvelope<T> | undefined): CursorPage<T> {
  if (!body || !Array.isArray(body.data)) throw new Error("malformed conversation response");
  const hasMore = body.hasMore === true;
  return { items: body.data, hasMore, nextCursor: hasMore ? String(body.nextCursor ?? "") : "" };
}

/** Builds query params, omitting blanks; datetime-local values become RFC3339 in the browser's zone. */
export function listParams(filters: ConversationFilters, cursor = "", limit = 20): Record<string, string> {
  const params: Record<string, string> = { type: filters.type, limit: String(limit) };
  const userId = filters.userId?.trim();
  if (userId) params.userId = userId;
  const from = toRFC3339(filters.from);
  const to = toRFC3339(filters.to);
  if (from) params.from = from;
  if (to) params.to = to;
  if (filters.includeDeleted && filters.type === "chat") params.includeDeleted = "true";
  if (cursor) params.cursor = cursor;
  return params;
}

export function toRFC3339(value?: string): string {
  if (!value?.trim()) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function conversationPath(type: ConversationType, id: number | string): string {
  if (type !== "chat" && type !== "im") throw new Error("invalid conversation type");
  const value = String(id);
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("invalid conversation id");
  return `${CONVERSATIONS_BASE}/${type}/${value}`;
}

export async function listConversations(filters: ConversationFilters, cursor = "", limit = 20): Promise<CursorPage<ConversationRow>> {
  const response = await http().get<PageEnvelope<ConversationRow>>(CONVERSATIONS_BASE, { params: listParams(filters, cursor, limit) });
  return page(response.data);
}

export async function getConversation(type: ConversationType, id: number | string): Promise<ConversationDetail> {
  const data = (await http().get<Envelope<ConversationDetail>>(conversationPath(type, id))).data?.data;
  if (!data) throw new Error("malformed conversation response");
  return data;
}

export async function listConversationMessages(type: ConversationType, id: number | string, cursor = "", limit = 50): Promise<CursorPage<ConversationMessage>> {
  const params: Record<string, string> = { limit: String(limit) };
  if (cursor) params.cursor = cursor;
  const response = await http().get<PageEnvelope<ConversationMessage>>(`${conversationPath(type, id)}/messages`, { params });
  return page(response.data);
}

/** Display name for a user reference; never invents one. */
export function userLabel(user: ConversationUser | undefined, id: number | undefined): string {
  if (user) return user.nickName && user.nickName !== user.username ? `${user.nickName} (${user.username})` : user.username;
  return id ? `UID ${id}` : "—";
}

/** Human size, e.g. 2048 -> "2.0 KB". */
export function formatSize(bytes?: number): string {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
