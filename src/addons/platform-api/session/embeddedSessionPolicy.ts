export function shouldAcceptShellSession(
  currentVersion: number,
  rejectedVersion: number | null,
  incomingVersion: number,
  hasToken: boolean,
): boolean {
  if (!Number.isSafeInteger(incomingVersion) || incomingVersion < 0) return false;
  if (incomingVersion < currentVersion) return false;
  if (hasToken && incomingVersion === rejectedVersion) return false;
  return true;
}
