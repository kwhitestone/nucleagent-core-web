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
