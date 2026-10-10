export interface ProviderModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ProviderConfig {
  baseUrl?: string;
  responsesBaseUrl?: string;
  responsesMode?: "native" | "translate";
  messagesBaseUrl?: string;
  messagesMode?: "" | "native" | "translate";
  apiFormat?: string;
  modelApiFormats?: Record<string, string[]>;
  modelLimits?: Record<string, ProviderModelLimits>;
  geminiBaseUrl?: string;
  authScheme?: string;
  models?: string[];
  [key: string]: unknown;
}

export interface Provider {
  id: number;
  name: string;
  config?: ProviderConfig;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserVisibleModel {
  configId: number;
  model: string;
  alias: string;
  isQuick: boolean;
  modeKeys?: string[];
  targetModel?: string;
}

/** Gateway model types (Q4 §3); Core `GET /provider/models?type=` accepts exactly these. */
export const MODEL_TYPES = ["chat", "image", "video", "audio", "embedding", "rerank", "other"] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

/** One entry of `GET /api/v1/addons/provider/models?type=` (MT2-core). */
export interface TypedModel {
  providerId: number;
  model: string;
  type: string;
  capabilities: string[];
}

export interface ModelCatalog {
  readonly listProviders: () => Promise<Provider[]>;
  readonly fetchVisibleModels: () => Promise<UserVisibleModel[]>;
  /** `null` = old Core (404) or no types synced yet (`typesAvailable:false`). */
  readonly listTypedModels: (type: ModelType) => Promise<TypedModel[] | null>;
}

let activeCatalog: ModelCatalog | undefined;

export function registerModelCatalog(catalog: ModelCatalog): () => void {
  if (activeCatalog) throw new Error("Model catalog is already registered");
  activeCatalog = catalog;
  return () => {
    if (activeCatalog === catalog) activeCatalog = undefined;
  };
}

export function getModelCatalog(): ModelCatalog {
  if (!activeCatalog) throw new Error("Model catalog is not installed");
  return activeCatalog;
}

export const listProviders = (): Promise<Provider[]> => getModelCatalog().listProviders();
export const fetchVisibleModels = (): Promise<UserVisibleModel[]> => (
  getModelCatalog().fetchVisibleModels()
);
export const listTypedModels = (type: ModelType): Promise<TypedModel[] | null> => (
  getModelCatalog().listTypedModels(type)
);

/** Every type's list, or `null` when the Core has no types (old Core). */
export async function listAllTypedModels(): Promise<Record<ModelType, TypedModel[]> | null> {
  const lists = await Promise.all(MODEL_TYPES.map((type) => listTypedModels(type)));
  if (lists.some((list) => list === null)) return null;
  return Object.fromEntries(MODEL_TYPES.map((type, i) => [type, lists[i]])) as Record<ModelType, TypedModel[]>;
}
