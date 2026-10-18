import { getPlatformRuntime } from "../../../contracts/platform-runtime.ts";

export const BINDINGS_MAX = 50;
export interface SessionBindings {
  skillIds: number[];
  toolIds: number[];
  editable: boolean;
}
function bindings(data: SessionBindings | undefined): SessionBindings {
  if (!data || !Array.isArray(data.skillIds) || !Array.isArray(data.toolIds) || typeof data.editable !== "boolean") {
    throw new Error("Invalid session bindings");
  }
  return data;
}
export async function getSessionBindings(id: string): Promise<SessionBindings> {
  const r = await getPlatformRuntime().http.get<{ data: SessionBindings }>(`/api/v1/addons/conversation/${encodeURIComponent(id)}/bindings`);
  return bindings(r.data.data);
}
export async function updateSessionBindings(id: string, selection: Pick<SessionBindings, "skillIds" | "toolIds">): Promise<SessionBindings> {
  const r = await getPlatformRuntime().http.put<{ data: SessionBindings }>(`/api/v1/addons/conversation/${encodeURIComponent(id)}/bindings`, selection);
  return bindings(r.data.data);
}
