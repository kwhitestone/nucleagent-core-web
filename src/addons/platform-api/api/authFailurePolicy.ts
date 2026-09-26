/**
 * Decide whether a 401 still applies to the active browser credential.
 *
 * A request started before iframe auth synchronization has no Authorization
 * header. Its delayed 401 must not clear a token that arrived in the meantime.
 * The same rule protects a refreshed token from a response sent for an older
 * credential.
 */
export function shouldHandleUnauthorized(
  currentToken: string,
  requestAuthorization: unknown,
): boolean {
  if (!currentToken) return true;
  // A-16: the gateway rejects `Bearer `-prefixed tokens, so the header is the bare token.
  return requestAuthorization === currentToken;
}
