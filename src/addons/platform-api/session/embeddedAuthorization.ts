import { readonly, ref } from "vue";

const permissions = ref<string[]>([]);

function validPermission(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && value.trim().split(":").length === 3;
}

export function replaceEmbeddedPermissions(values: readonly unknown[]): boolean {
  const next = [...new Set(values.filter(validPermission).map((value) => value.trim()))].sort();
  const changed = next.length !== permissions.value.length ||
    next.some((value, index) => value !== permissions.value[index]);
  if (changed) permissions.value = next;
  return changed;
}

export function hasEmbeddedPermission(required: string): boolean {
  const expected = required.trim().split(":");
  if (expected.length !== 3) return false;
  return permissions.value.some((permission) => {
    const granted = permission.split(":");
    return granted.length === 3 && granted.every((part, index) => part === "*" || part === expected[index]);
  });
}

/**
 * Standalone core keeps its historical navigation and relies on backend
 * authorization. Only an iframe has a shell-provided permission snapshot that
 * can safely drive presentation filtering.
 */
export function filterEmbeddedAuthorizedItems<T extends { permission: string }>(
  items: readonly T[],
  embedded: boolean,
  can: (permission: string) => boolean,
): T[] {
  if (!embedded) return [...items];
  return items.filter((item) => can(item.permission));
}

export function useEmbeddedAuthorization() {
  return {
    permissions: readonly(permissions),
    can: hasEmbeddedPermission,
  };
}
