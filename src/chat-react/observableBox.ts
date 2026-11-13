/** shallowRef-like `.value` boxes whose changed writes notify one shared listener set (for useSyncExternalStore). */
export function observableBoxes() {
  const listeners = new Set<() => void>();
  const box = <T>(current: T) => ({
    get value() { return current; },
    set value(next: T) { if (next !== current) { current = next; listeners.forEach((l) => l()); } },
  });
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
  return { box, subscribe };
}
