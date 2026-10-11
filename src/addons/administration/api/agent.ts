import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import { createDefinitionApi, DefinitionError, type Transport } from "../agents/definition/api";

export type { Impact as AgentImpact } from "../agents/definition/api";

export const definitionTransport: Transport = async (path, init = {}) => {
  const runtime = getPlatformRuntime();
  const version = runtime.getSessionVersion();
  const token = runtime.getAccessToken();
  try {
    const response = await runtime.http.request({
      url: path,
      method: init.method || "GET",
      headers: Object.fromEntries(new Headers(init.headers)),
      data: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      signal: init.signal ?? undefined,
    });
    if (runtime.getSessionVersion() !== version || runtime.getAccessToken() !== token) {
      throw new DefinitionError(401, "session_changed");
    }
    return { status: response.status, headers: { etag: String(response.headers.etag || "") }, body: response.data };
  } catch (error) {
    if (error instanceof ApiError) throw new DefinitionError(error.status, error.code);
    throw error;
  }
};

export const agentDefinitions = createDefinitionApi(definitionTransport);
