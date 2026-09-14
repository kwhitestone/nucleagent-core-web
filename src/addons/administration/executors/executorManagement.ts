import type { ConnectedExecutor, ExecutorManagementAPI, ExecutorRuntimeConfig, ExecutorRuntimeStatus, RuntimeBackendConfig, RuntimeUpdate } from "./types.ts";

export const RUNTIME_LIMITS = { processes: 64, sessionsPerProcess: 1024, maxConcurrency: 65_536 } as const;
type Issue = "invalidConcurrency" | "invalidProcesses" | "invalidSessions" | "invalidActiveSessions" | "legacyProcessLimit" | "unsupportedMode";

export function runtimeConfigFromStatus(status: ExecutorRuntimeStatus): ExecutorRuntimeConfig {
  return { maxConcurrency: status.maxConcurrency, backends: status.backends.map(row => ({
    backend: row.backend, mode: row.mode, minProcesses: row.minProcesses,
    maxProcesses: row.maxProcesses, sessionsPerProcess: row.sessionsPerProcess,
    maxActiveSessions: row.maxActiveSessions,
  })) };
}

const integer = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;

export function validateRuntimeConfig(config: ExecutorRuntimeConfig): Issue | null {
  if (!integer(config.maxConcurrency, 1, RUNTIME_LIMITS.maxConcurrency)) return "invalidConcurrency";
  for (const row of config.backends) {
    if (!integer(row.minProcesses, 1, RUNTIME_LIMITS.processes)) return "invalidProcesses";
    if (!integer(row.maxActiveSessions, row.mode === "dedicated" ? 1 : 0, RUNTIME_LIMITS.maxConcurrency)) return "invalidActiveSessions";
    if (row.mode === "dedicated" && row.maxProcesses === 0) return "legacyProcessLimit";
    if (!integer(row.maxProcesses, row.minProcesses, RUNTIME_LIMITS.processes)) return "invalidProcesses";
    if (row.mode === "dedicated") {
      if (row.sessionsPerProcess !== 1) return "invalidSessions";
    } else if (row.mode === "shared") {
      if (!integer(row.sessionsPerProcess, 1, RUNTIME_LIMITS.sessionsPerProcess)) return "invalidSessions";
    } else return "unsupportedMode";
  }
  return null;
}

export interface RuntimeEditor extends RuntimeUpdate { instanceId: string }
interface ManagementError { kind: "loadFailed" | "saveFailed" | "conflict" | "disconnected" | Issue; message?: string }
export interface ExecutorManagementState {
  instances: ConnectedExecutor[] | null;
  updatedAt: string | null;
  loading: boolean;
  saving: boolean;
  editor: RuntimeEditor | null;
  error: ManagementError | null;
  notice: "saved" | null;
}

const initialState = (): ExecutorManagementState => ({ instances: null, updatedAt: null, loading: false, saving: false, editor: null, error: null, notice: null });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : undefined;

export function createExecutorManagement(api: ExecutorManagementAPI, changed: (state: ExecutorManagementState) => void = () => {}) {
  let state = initialState();
  let disposed = false;
  let readGeneration = 0;
  let readAbort: AbortController | undefined;
  let writeAbort: AbortController | undefined;
  const publish = (patch: Partial<ExecutorManagementState>) => {
    if (disposed) return;
    state = { ...state, ...patch }; changed(state);
  };
  const current = (id: string) => state.instances?.find(instance => instance.instanceId === id);
  const invalidateRead = () => { readGeneration += 1; readAbort?.abort(); };

  async function refresh(keepError = false): Promise<void> {
    if (disposed || state.saving) return;
    invalidateRead(); const generation = readGeneration;
    const scope = new AbortController(); readAbort = scope;
    publish({ loading: true, ...(!keepError ? { error: null } : {}) });
    try {
      const result = await api.list(scope.signal);
      if (disposed || generation !== readGeneration) return;
      publish({ instances: result.instances, updatedAt: result.updatedAt });
    } catch (error) {
      if (disposed || generation !== readGeneration || scope.signal.aborted) return;
      if (!keepError) publish({ error: { kind: "loadFailed", message: errorMessage(error) } });
    } finally {
      if (!disposed && generation === readGeneration) publish({ loading: false });
    }
  }

  function edit(instanceId: string): boolean {
    const runtime = current(instanceId)?.runtime;
    if (disposed || state.saving || !runtime?.configurable) return false;
    publish({ editor: { instanceId, expectedRevision: runtime.revision, config: runtimeConfigFromStatus(runtime) }, error: null, notice: null });
    return true;
  }

  function setConcurrency(value: number): void {
    if (!state.editor || state.saving) return;
    publish({ editor: { ...state.editor, config: { ...state.editor.config, maxConcurrency: value } }, error: null });
  }

  function setBackend(index: number, key: "minProcesses" | "maxProcesses" | "sessionsPerProcess" | "maxActiveSessions", value: number): void {
    if (!state.editor || state.saving) return;
    const row = state.editor.config.backends[index];
    if (!row || (row.mode === "dedicated" && key === "sessionsPerProcess")) return;
    const backends = state.editor.config.backends.map((backend, position): RuntimeBackendConfig => position === index ? { ...backend, [key]: value } : backend);
    publish({ editor: { ...state.editor, config: { ...state.editor.config, backends } }, error: null });
  }

  async function save(): Promise<boolean> {
    if (disposed || state.saving || !state.editor) return false;
    const editor = state.editor;
    const instance = current(editor.instanceId);
    if (!instance?.runtime?.configurable) { publish({ error: { kind: "disconnected" } }); return false; }
    if (instance.runtime.revision !== editor.expectedRevision) { publish({ error: { kind: "conflict" } }); return false; }
    const invalid = validateRuntimeConfig(editor.config);
    if (invalid) { publish({ error: { kind: invalid } }); return false; }
    invalidateRead();
    const scope = new AbortController(); writeAbort = scope;
    publish({ saving: true, loading: false, error: null, notice: null });
    try {
      const result = await api.update(editor.instanceId, { expectedRevision: editor.expectedRevision, config: structuredClone(editor.config) }, scope.signal);
      if (disposed) return false;
      if (!result.accepted || !result.status) throw new Error(result.message || result.errorCode || "Configuration was not accepted");
      const runtime = result.status;
      publish({ instances: state.instances?.map(row => row.instanceId === editor.instanceId ? { ...row, runtime, maxConcurrency: runtime.maxConcurrency } : row) ?? null,
        editor: null, notice: "saved" });
      return true;
    } catch (error) {
      if (disposed || scope.signal.aborted) return false;
      publish({ saving: false, error: { kind: "saveFailed", message: errorMessage(error) } });
      await refresh(true);
      return false;
    } finally { if (!disposed) publish({ saving: false }); }
  }

  return {
    get state() { return state; }, refresh, edit, setConcurrency, setBackend, save,
    cancelEdit() { if (!state.saving) publish({ editor: null, error: null }); },
    dispose() { disposed = true; invalidateRead(); writeAbort?.abort(); state = initialState(); },
  };
}
