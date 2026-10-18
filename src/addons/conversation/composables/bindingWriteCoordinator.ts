import { shallowReactive } from "vue";
import type { SessionBindings } from "../api/sessionBindings";

// Survives protected-view destruction. Never retain payloads, promises or tokens.
const scopes = shallowReactive(new Map<string, { revision: string; unknown: boolean }>());
const key = (id: string, data: SessionBindings) => JSON.stringify([data.principal, id]);

export function bindingWriteStarted(id: string, data: SessionBindings): void {
  scopes.set(key(id, data), { revision: data.revision, unknown: true });
}

export function bindingSnapshotConfirmed(id: string, data: SessionBindings): boolean {
  const scope = key(id, data);
  const previous = scopes.get(scope);
  if (previous && (BigInt(data.revision) < BigInt(previous.revision) ||
    (previous.unknown && data.revision === previous.revision))) return false;
  scopes.set(scope, { revision: data.revision, unknown: false });
  return true;
}

export function bindingSnapshotCurrent(id: string, data: SessionBindings): boolean {
  const state = scopes.get(key(id, data));
  return !!state && !state.unknown && state.revision === data.revision;
}
