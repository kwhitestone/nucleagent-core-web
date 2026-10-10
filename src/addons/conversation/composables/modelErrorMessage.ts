// Relative .ts imports: loaded natively by node --test (coverage-gated in test:unit).
import { MODEL_TYPES } from "../../../contracts/model-catalog.ts";
import { ApiError } from "../../../contracts/platform-runtime.ts";

type Translate = (key: string, named?: Record<string, unknown>) => string;

/** i18n name of a model type; an unknown value (gateway added a type) is shown verbatim. */
export function modelTypeName(type: string, t: Translate): string {
  return (MODEL_TYPES as readonly string[]).includes(type) ? t(`model.types.${type}`) : type;
}

/**
 * User text for an error from a request that carried a model (MT2-coreweb).
 * Core's 400 `model_type_mismatch` carries `model` and `modelType`; it is worded
 * in the current language. Anything else keeps the server message, and a
 * non-API error falls back to `fallback` (or its own message).
 */
export function modelErrorMessage(error: unknown, t: Translate, fallback?: string): string {
  if (!(error instanceof ApiError)) return fallback ?? (error instanceof Error ? error.message : String(error));
  const { model, modelType } = error.problem;
  if (error.code === "model_type_mismatch" && typeof model === "string" && typeof modelType === "string" && modelType) {
    return t("model.typeMismatch", { model, type: modelTypeName(modelType, t) });
  }
  return error.message;
}

/** Admin definition save: the model-related 400s shown under the model field; "" = not a model error. */
export function modelFieldError(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError) || error.status !== 400) return "";
  if (error.code !== "model_type_mismatch" && error.code !== "im_invalid_provider_model") return "";
  return modelErrorMessage(error, t);
}
