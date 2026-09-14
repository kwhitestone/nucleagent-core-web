/**
 * Token persistence helpers.
 *
 * The JWT (access token) is issued by the nucleagent-auth backend and shared
 * across micro-app sub-apps. auth-web writes it to localStorage under
 * `nucleagent_access_token`; we read from the same key so a user signed in via
 * the auth sub-app is automatically authenticated here.
 */

const ACCESS_TOKEN_KEY = "nucleagent_access_token";
let embeddedAccessToken = "";

function isEmbedded(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

export function getAccessToken(): string {
  return isEmbedded() ? embeddedAccessToken : localStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
}

/** Only the verified shell message handler supplies embedded credentials. */
export function setAccessToken(token: string): void {
  if (isEmbedded()) {
    embeddedAccessToken = token;
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  } else localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  embeddedAccessToken = "";
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}
