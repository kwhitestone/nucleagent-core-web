import { getPlatformRuntime } from "../../../contracts/platform-runtime.ts";

export const BINDINGS_MAX = 50;
export const BINDINGS_DEADLINE_MS = 15000;
export interface SessionBindings {
  skillIds: number[];
  toolIds: number[];
  editable: boolean;
  revision: string;
  principal: string;
}
function bindings(data: SessionBindings | undefined): SessionBindings {
  if (!data || !Array.isArray(data.skillIds) || !Array.isArray(data.toolIds) || typeof data.editable !== "boolean" ||
    typeof data.revision !== "string" || !/^(0|[1-9][0-9]*)$/.test(data.revision) ||
    BigInt(data.revision) > 18446744073709551615n ||
    typeof data.principal !== "string" || !/^[1-9][0-9]*$/.test(data.principal)) {
    throw new Error("Invalid session bindings");
  }
  return data;
}
// A local deadline also covers adapters that ignore transport cancellation.
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let stop!: () => void;
  const canceled = new Promise<never>((_, reject) => {
    stop = () => {
      controller.abort();
      reject(new Error("Bindings result unknown"));
    };
  });
  const timer = setTimeout(stop, BINDINGS_DEADLINE_MS);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try {
    return await Promise.race([canceled, run(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
export async function getSessionBindings(id: string): Promise<SessionBindings> {
  const r = await getPlatformRuntime().http.get<{ data: SessionBindings }>(`/api/v1/addons/conversation/${encodeURIComponent(id)}/bindings`);
  return bindings(r.data.data);
}
export async function syncSessionBindings(id: string, signal?: AbortSignal): Promise<SessionBindings> {
  const r = await bounded((signal) => getPlatformRuntime().http.post<{ data: SessionBindings }>(
    `/api/v1/addons/conversation/${encodeURIComponent(id)}/bindings/sync`, {}, { signal }), signal);
  return bindings(r.data.data);
}
export async function updateSessionBindings(id: string, selection: Pick<SessionBindings, "skillIds" | "toolIds" | "revision">, signal?: AbortSignal): Promise<SessionBindings> {
  const r = await bounded((signal) => getPlatformRuntime().http.put<{ data: SessionBindings }>(
    `/api/v1/addons/conversation/${encodeURIComponent(id)}/bindings`, selection, { signal }), signal);
  return bindings(r.data.data);
}
