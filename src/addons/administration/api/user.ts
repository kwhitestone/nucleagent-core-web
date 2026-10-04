/**
 * Accounts (admin) — addons/admin/router/users.go.
 *
 * Disabling an account refuses its logins, ends its sessions on their next
 * request and stops IM from delivering to it; enabling restores all of it.
 */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Envelope } from "./admin";

const http = () => getPlatformRuntime().http;
const BASE = "/api/v1/addons/admin/users";

export interface AdminUser {
  id: number;
  username: string;
  nickName: string;
  headerImg: string;
  accountType: string;
  roleId: number;
  isActive: boolean;
}

export async function listUsers(q = "", offset = 0, limit = 20): Promise<{ items: AdminUser[]; total: number }> {
  const response = await http().get<Envelope<AdminUser[]> & { total?: number }>(BASE, { params: { q, offset, limit } });
  return { items: response.data?.data ?? [], total: response.data?.total ?? 0 };
}

export async function setUserActive(id: number, isActive: boolean): Promise<AdminUser> {
  const saved = (await http().patch<Envelope<AdminUser>>(`${BASE}/${id}`, { isActive })).data?.data;
  if (!saved) throw new Error("malformed user response");
  return saved;
}
