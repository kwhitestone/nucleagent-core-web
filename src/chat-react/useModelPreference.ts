import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import type { ProfileSelection } from "./modelProfile";
import { EFFORT_LEVELS, type EffortChoice } from "./requestEffort";

type Preference = { profileId: string; effort: EffortChoice };
/** One /model-profiles row (Core svc.ModelProfile); `params` is read-only display (D4A). */
export type ProfileRow = { id: string; displayName?: string; enabled: boolean; efforts?: string[]; params?: Record<string, string> };
type Catalog = ProfileRow[];
type Selection = { executionBackend: string; providerId?: number; model: string };
const endpoint = "/api/v1/addons/conversation/model-preferences";

export function useModelPreference(scope: string, backend: string, providerId: number | undefined, model: string) {
  const generation = useRef(0);
  const writing = useRef(false);
  const confirmed = useRef(false);
  const transport = useRef<AbortController | null>(null);
  const reload = useRef<() => void>(() => {});
  const key = JSON.stringify([scope, backend, providerId, model]);
  const renderedKey = useRef(key);
  renderedKey.current = key;
  const [state, setState] = useState<{ key: string; session: number; turn: number; signal: AbortSignal; selection: Selection; preference: Preference; catalog: Catalog; ready: boolean; error: boolean; pending?: Preference; rolledBack?: boolean }>();
  useEffect(() => {
    const load = () => {
      transport.current?.abort();
      const controller = new AbortController();
      transport.current = controller;
      const turn = ++generation.current;
      writing.current = false;
      confirmed.current = false;
      setState(undefined);
      if (!backend) return;
      const runtime = getPlatformRuntime(), session = runtime.getSessionVersion();
      const identity = { key, session, turn, signal: controller.signal };
      const live = () => key === renderedKey.current && turn === generation.current && session === runtime.getSessionVersion() && !controller.signal.aborted;
      const initial = { executionBackend: backend, providerId, model };
      const selection = model ? Promise.resolve(initial) : runtime.http.get<{ data: Selection & { resolved: boolean } }>("/api/v1/addons/conversation/model-selection", { params: { executionBackend: backend }, signal: controller.signal }).then((response) => {
        const value = response.data.data;
        if (value?.executionBackend !== backend || typeof value.model !== "string" || typeof value.resolved !== "boolean" || (value.resolved && (!value.model.trim() || !Number.isSafeInteger(value.providerId) || value.providerId! <= 0)) || (!value.resolved && (value.model || value.providerId))) throw 0;
        return { executionBackend: value.executionBackend, providerId: value.providerId || undefined, model: value.model };
      });
      selection.then(async (params) => {
        if (!live()) return;
        const [preference, catalog] = await Promise.all([
          runtime.http.get<{ data: Preference }>(endpoint, { params, signal: controller.signal }),
          runtime.http.get<{ data: Catalog }>("/api/v1/addons/conversation/model-profiles", { params, signal: controller.signal }),
        ]);
        const value = preference.data.data;
        if (!value || typeof value.profileId !== "string" || (value.effort !== "" && !EFFORT_LEVELS.includes(value.effort)) || !Array.isArray(catalog.data.data)) throw 0;
        if (live()) {
          confirmed.current = true;
          setState({ ...identity, selection: params, preference: value, catalog: catalog.data.data, ready: true, error: false });
        }
      }).catch(() => {
        if (live()) setState({ ...identity, selection: initial, preference: { profileId: "", effort: "" }, catalog: [], ready: false, error: true });
      });
    };
    reload.current = load;
    load();
    window.addEventListener(SESSION_CHANGE_EVENT, load);
    return () => { generation.current++; transport.current?.abort(); window.removeEventListener(SESSION_CHANGE_EVENT, load); };
  }, [scope, backend, providerId, model]);
  const current = state?.key === key && state.session === getPlatformRuntime().getSessionVersion() ? state : undefined;
  const live = () => !!current && current.key === renderedKey.current && current.turn === generation.current && current.session === getPlatformRuntime().getSessionVersion() && !current.signal.aborted;
  const ready = () => !!current?.ready && live() && confirmed.current && !writing.current;
  const selected = current?.catalog.find((entry) => entry.enabled && entry.id === current.preference.profileId);
  const profile: ProfileSelection | null = selected ? { scope, profileId: selected.id, efforts: selected.efforts } : null;
  const choice = EFFORT_LEVELS.includes(current?.preference.effort as typeof EFFORT_LEVELS[number]) ? current!.preference.effort : "";
  async function save(profileId: string, effort: EffortChoice) {
    if (!current || !ready()) return;
    const runtime = getPlatformRuntime();
    const params = current.selection;
    const signal = current.signal;
    writing.current = true;
    confirmed.current = false;
    setState({ ...current, ready: false, error: false, pending: { profileId, effort }, rolledBack: false });
    try {
      // exp104 S3: a failed or unacknowledged PUT is never replayed; the server's own readback decides what is kept.
      // A PUT that succeeded must read back exactly; one that failed is reconciled to whatever the server kept.
      const failed = await runtime.http.put(endpoint, { profileId, effort }, { params, signal }).then(() => false, () => true);
      if (!live()) return;
      const response = await runtime.http.get<{ data: Preference }>(endpoint, { params, signal });
      const value = response.data.data;
      if (!live()) return;
      const kept = value?.profileId === profileId && value.effort === effort;
      if (typeof value?.profileId !== "string" || (value.effort !== "" && !EFFORT_LEVELS.includes(value.effort)) || (!failed && !kept)) throw 0;
      confirmed.current = true;
      setState({ ...current, preference: value, ready: true, error: false, pending: undefined, rolledBack: !kept });
    } catch {
      if (live()) setState({ ...current, ready: false, error: true, pending: undefined });
    } finally {
      if (live()) writing.current = false;
    }
  }
  return { profile, storedProfileId: current?.preference.profileId ?? "", choice, save, selection: current?.selection, get ready() { return ready(); }, error: !!current?.error,
    catalog: current?.catalog ?? [], pending: current?.pending, rolledBack: !!current?.rolledBack, reload: () => reload.current() };
}
