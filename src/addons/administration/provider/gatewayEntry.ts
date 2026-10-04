import type { Provider } from "@/contracts/model-catalog";

/**
 * The Providers page shows one entry, 目鱼网关 (UNI-UI-GAP; GWLINK design
 * §2.1(6)): every active Core provider row points at the gateway, so the
 * gateway's catalog is the union of their models. Deactivated rows (collapsed
 * by GWLINK W3) and inbound A2A rows (`ext:a2a:*`, not model providers) are
 * not shown. After W3's collapse this is exactly the surviving row.
 */
export function gatewayModels(providers: Provider[]): string[] {
  const models = providers
    .filter((p) => p.isActive && !p.name.startsWith("ext:a2a:"))
    .flatMap((p) => (Array.isArray(p.config?.models) ? p.config.models : []))
    .filter((m): m is string => typeof m === "string" && m.trim() !== "")
    .map((m) => m.trim());
  return [...new Set(models)];
}

/**
 * When Core last read the gateway catalog (UNI-GWLINK-R4): Core's 5-minute
 * sync stamps `config.catalogSyncedAt` on the surviving row. `null` before
 * the first sync (W3 off, or the gateway unreachable since boot).
 */
export function gatewaySyncedAt(providers: Provider[]): Date | null {
  const times = providers
    .filter((p) => p.isActive && !p.name.startsWith("ext:a2a:"))
    .map((p) => Date.parse(String(p.config?.catalogSyncedAt ?? "")))
    .filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/** `YYYY-MM-DD HH:mm` in the viewer's local time. */
export function formatSyncedAt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
