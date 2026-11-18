import { useEffect, useRef, useState } from "react";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import type { ProfileSelection } from "./modelProfile";
import { EFFORT_LEVELS, type EffortChoice } from "./requestEffort";

type Preference = { profileId: string; effort: EffortChoice };
type Catalog = { id: string; enabled: boolean; efforts?: string[] }[];
const endpoint = "/api/v1/addons/conversation/model-preferences";

export function useModelPreference(scope: string, backend: string, providerId: number | undefined, model: string) {
  const generation = useRef(0);
  const writing = useRef(false);
  const confirmed = useRef(false);
  const transport = useRef<AbortController | null>(null);
  const key = JSON.stringify([scope, backend, providerId, model]);
  const renderedKey = useRef(key);
  renderedKey.current = key;
  const [state, setState] = useState<{ key: string; session: number; turn: number; signal: AbortSignal; preference: Preference; catalog: Catalog; ready: boolean; error: boolean }>();
  useEffect(() => {
    const load = () => {
      transport.current?.abort();
      const controller = new AbortController();
      transport.current = controller;
      const turn = ++generation.current;
      writing.current = false;
      confirmed.current = false;
      setState(undefined);
      if (!backend || !model) return;
      const runtime = getPlatformRuntime(), session = runtime.getSessionVersion();
      const identity = { key, session, turn, signal: controller.signal };
      const live = () => key === renderedKey.current && turn === generation.current && session === runtime.getSessionVersion() && !controller.signal.aborted;
      const params = { executionBackend: backend, providerId, model };
      Promise.all([
        runtime.http.get<{ data: Preference }>(endpoint, { params, signal: controller.signal }),
        runtime.http.get<{ data: Catalog }>("/api/v1/addons/conversation/model-profiles", { params, signal: controller.signal }),
      ]).then(([preference, catalog]) => {
        const value = preference.data.data;
        if (!value || typeof value.profileId !== "string" || (value.effort !== "" && !EFFORT_LEVELS.includes(value.effort)) || !Array.isArray(catalog.data.data)) throw new Error("Invalid preference response");
        if (live()) {
          confirmed.current = true;
          setState({ ...identity, preference: value, catalog: catalog.data.data, ready: true, error: false });
        }
      }).catch(() => {
        if (live()) setState({ ...identity, preference: { profileId: "", effort: "" }, catalog: [], ready: false, error: true });
      });
    };
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
    const params = { executionBackend: backend, providerId, model };
    const signal = current.signal;
    writing.current = true;
    confirmed.current = false;
    setState({ ...current, ready: false, error: false });
    try {
      await runtime.http.put(endpoint, { profileId, effort }, { params, signal });
      if (!live()) return;
      const response = await runtime.http.get<{ data: Preference }>(endpoint, { params, signal });
      if (!live()) return;
      if (response.data.data.profileId !== profileId || response.data.data.effort !== effort) throw new Error("Preference readback mismatch");
      confirmed.current = true;
      setState({ ...current, preference: response.data.data, ready: true, error: false });
    } catch {
      if (live()) setState({ ...current, ready: false, error: true });
    } finally {
      if (live()) writing.current = false;
    }
  }
  return { profile, choice, save, get ready() { return ready(); }, error: !!current?.error };
}
