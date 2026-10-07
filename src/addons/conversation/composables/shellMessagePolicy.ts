export function resolveShellViewPath(message: unknown): string | null {
  if (message === null || typeof message !== "object") return null;
  const data = message as { source?: unknown; type?: unknown; path?: unknown };
  if (data.source !== "shell" || data.type !== "view" || typeof data.path !== "string") return null;
  const path = data.path.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.length > 512) return null;
  return path;
}

/**
 * The shell's compare-backends route (Q6) arrives as /b/:groupId/:memberId;
 * Core's own route keeps the member in ?conversationId=.
 */
export function shellViewLocation(path: string): { path: string; query?: { conversationId: string } } {
  const member = path.match(/^(\/b\/[a-zA-Z0-9_-]{1,128})\/(\d+)$/);
  return member ? { path: member[1], query: { conversationId: member[2] } } : { path };
}

/**
 * O-1: whether Core reports its own route to the shell (view-changed). Not
 * before the shell's first view (the boot-time /chat), not a route the shell
 * itself just asked for, and not conversations (/c, /b): those promote through
 * the conversations message.
 */
export function shouldReportView(path: string, followingShell: boolean, shellInduced: string | null): boolean {
  return followingShell && path !== shellInduced && !/^\/[cb]\//.test(path);
}
