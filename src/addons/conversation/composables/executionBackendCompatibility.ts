import type { Provider } from "@/contracts/model-catalog";
import type { ExecutionBackendOption, ModelChoice } from "@/addons/conversation/api/types";

export type ExecutionBackendCompatibilityReason = "" | "model_required" | "protocol_incompatible";

export interface ExecutionBackendCompatibility {
  allowed: boolean;
  reason: ExecutionBackendCompatibilityReason;
}

function inferAPIFormat(configured: unknown, model: string): string {
  const normalized = typeof configured === "string" ? configured.trim().toLowerCase() : "";
  if (["openai", "anthropic", "gemini"].includes(normalized)) return normalized;
  const lowerModel = model.trim().toLowerCase();
  if (lowerModel.startsWith("claude-")) return "anthropic";
  if (lowerModel.startsWith("gemini") || lowerModel.includes("/gemini")) return "gemini";
  return "openai";
}

export function executionBackendCompatibility(
  backend: ExecutionBackendOption,
  modelChoice: ModelChoice | null,
  providers: Provider[],
): ExecutionBackendCompatibility {
  const requiresExplicitModel = backend.requiresExplicitModel ??
    ["opencode", "gemini-cli", "deepseek-harness"].includes(backend.id);
  if (requiresExplicitModel && !modelChoice) {
    return { allowed: false, reason: "model_required" };
  }
  if (!modelChoice) return { allowed: true, reason: "" };

  const provider = providers.find((item) => item.id === modelChoice.providerId && item.isActive);
  if (!provider) return { allowed: false, reason: "protocol_incompatible" };
  const actualFormat = inferAPIFormat(provider?.config?.apiFormat, modelChoice.model);
  if (backend.id === "claude-code") {
    const configuredMode = typeof provider?.config?.messagesMode === "string"
      ? provider.config.messagesMode.trim().toLowerCase()
      : "";
    const hasMessagesBase = typeof provider?.config?.messagesBaseUrl === "string" && provider.config.messagesBaseUrl.trim() !== "";
    const supportsMessages = (configuredMode === "native" && (actualFormat === "anthropic" || hasMessagesBase)) ||
      (configuredMode === "translate" && actualFormat === "openai") ||
      (configuredMode === "" && actualFormat === "anthropic");
    return supportsMessages
      ? { allowed: true, reason: "" }
      : { allowed: false, reason: "protocol_incompatible" };
  }
  const requiredFormat = backend.requiredApiFormat?.trim().toLowerCase() ||
    (backend.id === "gemini-cli" ? "gemini" : backend.id === "claude-code" ? "anthropic" : "openai");
  const additionalFormats = provider?.config?.modelApiFormats?.[modelChoice.model.trim()];
  // Older Core versions do not advertise translation; keep their native-only contract.
  const supportedFormats = Array.isArray(backend.supportedApiFormats)
    ? backend.supportedApiFormats
    : [requiredFormat];
  if (backend.id === "gemini-cli") {
    const model = modelChoice.model.trim();
    const listed = provider.config?.models;
    if (Array.isArray(listed) && listed.length > 0 && !listed.some((name) => name.trim() === model)) {
      return { allowed: false, reason: "protocol_incompatible" };
    }
    const safeNativeModel = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(model);
    const allowed = supportedFormats.some((format) =>
      (format === "openai" || (format === "gemini" && safeNativeModel)) &&
      (actualFormat === format || (Array.isArray(additionalFormats) && additionalFormats.includes(format))));
    return { allowed, reason: allowed ? "" : "protocol_incompatible" };
  }
  if (!supportedFormats.some((format) => format === actualFormat ||
      (Array.isArray(additionalFormats) && additionalFormats.includes(format)))) {
    return { allowed: false, reason: "protocol_incompatible" };
  }
  return { allowed: true, reason: "" };
}
