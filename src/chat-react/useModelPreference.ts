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
  const transport = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ scope: string; session: number; preference: Preference; catalog: Catalog; ready: boolean; error: boolean }>();
  useEffect(() => {
    const load = () => {
      transport.current?.abort();
      const controller = new AbortController();
      transport.current = controller;
      const turn = ++generation.current;
      writing.current = false;
      setState(undefined);
      if (!backend || !model) return;
      const runtime = getPlatformRuntime(), session = runtime.getSessionVersion();
      const params = { executionBackend: backend, providerId, model };
      Promise.all([
        runtime.http.get<{ data: Preference }>(endpoint, { params, signal: controller.signal }),
        runtime.http.get<{ data: Catalog }>("/api/v1/addons/conversation/model-profiles", { params, signal: controller.signal }),
      ]).then(([preference, catalog]) => {
        const value = preference.data.data;
        if (!value || typeof value.profileId !== "string" || (value.effort !== "" && !EFFORT_LEVELS.includes(value.effort)) || !Array.isArray(catalog.data.data)) throw new Error("Invalid preference response");
        if (turn === generation.current && session === runtime.getSessionVersion())
          setState({ scope, session, preference: value, catalog: catalog.data.data, ready: true, error: false });
      }).catch(() => {
        if (turn === generation.current && session === runtime.getSessionVersion())
          setState({ scope, session, preference: { profileId: "", effort: "" }, catalog: [], ready: false, error: true });
      });
    };
    load();
    window.addEventListener(SESSION_CHANGE_EVENT, load);
    return () => { generation.current++; transport.current?.abort(); window.removeEventListener(SESSION_CHANGE_EVENT, load); };
  }, [scope, backend, providerId, model]);
  const current = state?.scope === scope ? state : undefined;
  const selected = current?.catalog.find((entry) => entry.enabled && entry.id === current.preference.profileId);
  const profile: ProfileSelection | null = selected ? { scope, profileId: selected.id, efforts: selected.efforts } : null;
  const choice = EFFORT_LEVELS.includes(current?.preference.effort as typeof EFFORT_LEVELS[number]) ? current!.preference.effort : "";
  async function save(profileId: string, effort: EffortChoice) {
    if (!current?.ready || writing.current) return;
    const turn = generation.current, runtime = getPlatformRuntime(), session = runtime.getSessionVersion();
    if (current.session !== session) return;
    const live = () => turn === generation.current && session === runtime.getSessionVersion();
    const params = { executionBackend: backend, providerId, model };
    const signal = transport.current?.signal;
    if (!signal || signal.aborted) return;
    writing.current = true;
    setState({ ...current, ready: false, error: false });
    try {
      await runtime.http.put(endpoint, { profileId, effort }, { params, signal });
      if (!live()) return;
      const response = await runtime.http.get<{ data: Preference }>(endpoint, { params, signal });
      if (!live()) return;
      if (response.data.data.profileId !== profileId || response.data.data.effort !== effort) throw new Error("Preference readback mismatch");
      setState({ ...current, preference: response.data.data, ready: true, error: false });
    } catch {
      if (live()) setState({ ...current, ready: false, error: true });
    } finally {
      if (live()) writing.current = false;
    }
  }
  return { profile, choice, save, get ready() { return !!current?.ready && current.session === getPlatformRuntime().getSessionVersion(); }, error: !!current?.error };
}
