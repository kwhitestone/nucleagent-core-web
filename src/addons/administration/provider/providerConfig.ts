import type { ProviderConfig } from "@/contracts/model-catalog";

export interface ProviderModelLimitsForm {
  contextWindow: string;
  maxOutputTokens: string;
}

export interface ProviderConfigForm {
  baseUrl: string;
  responsesBaseUrl: string;
  responsesMode: "native" | "translate";
  messagesBaseUrl: string;
  messagesMode: "" | "native" | "translate";
  apiFormat: string;
  authScheme: string;
  models: string;
  modelLimits: Record<string, ProviderModelLimitsForm>;
}

export type ProviderURLValidationError =
  | "base_required"
  | "base_https"
  | "responses_https"
  | "responses_origin"
  | "messages_https"
  | "messages_origin";

export function parseProviderModels(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const model = part.trim();
    if (model !== "" && !out.includes(model)) out.push(model);
  }
  return out;
}

export function providerConfigToForm(config: ProviderConfig = {}): ProviderConfigForm {
  return {
    baseUrl: config.baseUrl ?? "",
    responsesBaseUrl: config.responsesBaseUrl ?? "",
    responsesMode: config.responsesMode === "translate" ? "translate" : "native",
    messagesBaseUrl: config.messagesBaseUrl ?? "",
    messagesMode: config.messagesMode === "translate" || config.messagesMode === "native"
      ? config.messagesMode
      : config.apiFormat === "anthropic" ? "native" : "",
    apiFormat: config.apiFormat || "openai",
    authScheme: config.authScheme || "bearer",
    models: Array.isArray(config.models) ? config.models.join(", ") : "",
    modelLimits: Object.fromEntries(Object.entries(config.modelLimits ?? {}).map(([model, limits]) => [model, {
      contextWindow: String(limits.contextWindow),
      maxOutputTokens: String(limits.maxOutputTokens),
    }])),
  };
}

export function buildProviderConfig(
  form: ProviderConfigForm,
  existing: ProviderConfig = {},
): ProviderConfig {
  const invalid = validateProviderModelLimits(form);
  if (invalid) throw new RangeError(`Invalid model limits: ${invalid.model}`);
  const models = parseProviderModels(form.models);
  const removed = (existing.models ?? []).filter((model) => !models.includes(model));
  const modelLimits = Object.fromEntries(Object.entries(form.modelLimits)
    .filter(([model, limits]) => !removed.includes(model) && limits.contextWindow.trim() !== "")
    .map(([model, limits]) => [model, {
      contextWindow: Number(limits.contextWindow), maxOutputTokens: Number(limits.maxOutputTokens),
    }]));
  return {
    ...existing,
    baseUrl: form.baseUrl.trim(),
    responsesBaseUrl: form.responsesBaseUrl.trim(),
    responsesMode: form.responsesMode,
    messagesBaseUrl: form.messagesBaseUrl.trim(),
    messagesMode: form.messagesMode,
    apiFormat: form.apiFormat,
    authScheme: form.authScheme,
    models,
    ...(existing.modelLimits !== undefined || Object.keys(modelLimits).length > 0 ? { modelLimits } : {}),
  };
}

export function validateProviderModelLimits(form: ProviderConfigForm): { model: string } | null {
  for (const model of parseProviderModels(form.models)) {
    const limits = Object.hasOwn(form.modelLimits, model) ? form.modelLimits[model] : undefined;
    if (!limits || (limits.contextWindow.trim() === "" && limits.maxOutputTokens.trim() === "")) continue;
    const context = Number(limits.contextWindow);
    const output = Number(limits.maxOutputTokens);
    if (!Number.isInteger(context) || context < 1024 || context > 2097152 ||
        !Number.isInteger(output) || output < 1 || output > Math.min(context - 1, 262144)) return { model };
  }
  return null;
}

export function validateProviderURLs(
  baseRaw: string,
  responsesRaw: string,
  messagesRaw: string,
): ProviderURLValidationError | null {
  const baseText = baseRaw.trim();
  if (baseText === "") return "base_required";

  const base = parseSecureURL(baseText);
  if (base === null) return "base_https";

  const responsesText = responsesRaw.trim();
  if (responsesText !== "") {
    const responses = parseSecureURL(responsesText);
    if (responses === null) return "responses_https";
    if (responses.origin !== base.origin) return "responses_origin";
  }

  const messagesText = messagesRaw.trim();
  if (messagesText === "") return null;
  const messages = parseSecureURL(messagesText);
  if (messages === null) return "messages_https";
  return messages.origin === base.origin ? null : "messages_origin";
}

function parseSecureURL(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
