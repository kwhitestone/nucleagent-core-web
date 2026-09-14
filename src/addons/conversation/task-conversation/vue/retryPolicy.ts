const BASE_RETRY_DELAY_MS = 750;
const MAX_RETRY_DELAY_MS = 30_000;

export function isAuthenticationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

export function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(16, Math.floor(attempt)));
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** exponent);
}
