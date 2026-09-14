export function resolveShellViewPath(message: unknown): string | null {
  if (message === null || typeof message !== "object") return null;
  const data = message as { source?: unknown; type?: unknown; path?: unknown };
  if (data.source !== "shell" || data.type !== "view" || typeof data.path !== "string") return null;
  const path = data.path.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.length > 512) return null;
  return path;
}
