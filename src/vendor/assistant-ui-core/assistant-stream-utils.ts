/**
 * Build-time stand-in for assistant-stream 0.3.57 `assistant-stream/utils` (vite.config.ts alias), MUYU-365 exp86c.
 * The island's only importer is @assistant-ui/core's message conversion, which parses `argsText` only for a tool-call
 * part without `args`; threadMessages.ts always sends `args: {}`, so that branch never runs and the partial-JSON
 * repair (fix-json + secure-json-parse) is left out of the island (180 KiB budget). Complete JSON parses as before;
 * a partial or unsafe text yields undefined (the caller then uses `{}`).
 * shortcut: no partial tool-args streaming; drop the alias before sending a tool-call part without `args`.
 */
const META = Symbol("aui.parse-partial-json-object.meta");

export function parsePartialJsonObject(json: string): Record<string | symbol, unknown> | undefined {
  if (!json) return { [META]: { state: "partial", partialPath: [] } };
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null || /"(?:__proto__|constructor)"\s*:/.test(json)) return undefined;
    return Object.assign(value, { [META]: { state: "complete", partialPath: [] } });
  } catch { return undefined; }
}
