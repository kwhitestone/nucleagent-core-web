import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * Phone/tablet layout switch (UNI-MOBILE-IMPL Ruling 1a: below 1024px).
 * Inside the shell iframe the media query sees the iframe's own width, which
 * below 1024px is the full screen (the shell hides its sidebar there).
 */
export const NARROW_QUERY = "(max-width: 1023.98px)";

export function useNarrow(): Ref<boolean> {
  const query = typeof window !== "undefined" ? window.matchMedia?.(NARROW_QUERY) : undefined;
  const narrow = ref(query?.matches ?? false);
  const update = (event: MediaQueryListEvent) => { narrow.value = event.matches; };
  query?.addEventListener("change", update);
  onBeforeUnmount(() => query?.removeEventListener("change", update));
  return narrow;
}
