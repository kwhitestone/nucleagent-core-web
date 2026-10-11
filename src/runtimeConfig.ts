import { outerAware } from "./outerHost.ts";

export const RUNTIME_CONFIG_KEYS = [
  "VITE_CORE_WEB_URL",
  "VITE_SHELL_URL",
  "VITE_CORE_BACKEND_URL",
  "VITE_STORAGE_URL",
  "VITE_AUTH_BACKEND_URL",
  "VITE_EMBED_HOST_ORIGINS",
] as const;
export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number];
export type RuntimeConfig = Readonly<Record<RuntimeConfigKey, string>>;

function origin(value: unknown, key: string): URL {
  // Never echo operator input: a malformed URL may contain a credential.
  const invalid = () => new Error(`runtime-config.json: invalid ${key} origin`);
  if (typeof value !== "string" || value.trim() !== value) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.origin !== value ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+){2,}$/.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith(".localhost")) throw invalid();
  return url;
}

/** Exact site + sibling environment namespace, before the existing outer mapping. */
export function parseRuntimeConfig(body: unknown, pageOrigin: string): RuntimeConfig {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("runtime-config.json: expected an object");
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== RUNTIME_CONFIG_KEYS.length ||
      Object.keys(input).some(key => !(RUNTIME_CONFIG_KEYS as readonly string[]).includes(key))) {
    throw new Error("runtime-config.json: unexpected or missing keys");
  }
  const site = origin(input.VITE_CORE_WEB_URL, "VITE_CORE_WEB_URL");
  const page = origin(pageOrigin, "page");
  if (outerAware(site.origin, page.hostname) !== page.origin) {
    throw new Error("runtime-config.json: unrecognized page origin");
  }
  const namespace = site.hostname.slice(site.hostname.indexOf("."));
  const endpoint = (value: unknown, key: string): string => {
    const url = origin(value, key);
    if (url.hostname.slice(url.hostname.indexOf(".")) !== namespace) {
      throw new Error(`runtime-config.json: ${key} crosses the environment namespace`);
    }
    return outerAware(url.origin, page.hostname);
  };
  const out = {} as Record<RuntimeConfigKey, string>;
  for (const key of RUNTIME_CONFIG_KEYS) {
    if (key === "VITE_EMBED_HOST_ORIGINS") {
      const value = input[key];
      if (typeof value !== "string") throw new Error(`runtime-config.json: missing ${key}`);
      out[key] = value === "" ? "" : value.split(",").map(item => endpoint(item, key)).join(",");
    } else {
      out[key] = endpoint(input[key], key);
    }
  }
  return Object.freeze(out);
}

export async function fetchRuntimeConfig(pageOrigin: string, fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const page = origin(pageOrigin, "page");
  const response = await fetchImpl(`${page.origin}/runtime-config.json`, {
    headers: { accept: "application/json" }, credentials: "omit",
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`runtime-config.json: HTTP ${response.status}`);
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("runtime-config.json: invalid JSON"); }
  return parseRuntimeConfig(body, page.origin);
}

let current: RuntimeConfig | undefined;
let pending: Promise<void> | undefined;
export function loadRuntimeConfig(pageOrigin = location.origin, fetchImpl: typeof fetch = fetch): Promise<void> {
  return pending ??= fetchRuntimeConfig(pageOrigin, fetchImpl).then(config => { current = config; });
}

export function configValue(key: RuntimeConfigKey): string {
  if (!current) throw new Error("runtime-config.json: not initialized");
  return current[key];
}
