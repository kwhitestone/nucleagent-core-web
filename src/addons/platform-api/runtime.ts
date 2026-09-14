import type { PlatformRuntime } from "@/contracts/platform-runtime";
import { getAccessToken } from "@/utils/token";
import { authenticatedView } from "./session/authenticatedView";
import http, {
  apiBase,
  authHeaders,
  handleUnauthorizedResponse,
} from "./api/http";
import {
  filterEmbeddedAuthorizedItems,
  useEmbeddedAuthorization,
} from "./session/embeddedAuthorization";
import {
  applyShellSession,
  isInShell,
  setAuthRequiredNotifier,
  sessionVersion,
} from "./session/embeddedSession";

export const platformRuntime: PlatformRuntime = {
  authenticatedView,
  http,
  apiBase,
  authHeaders,
  handleUnauthorizedResponse,
  getAccessToken,
  getSessionVersion: sessionVersion,
  isInShell,
  applyShellSession,
  setAuthRequiredNotifier,
  filterEmbeddedAuthorizedItems,
  useEmbeddedAuthorization,
};
