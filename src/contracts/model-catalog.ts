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
  onlineAt?: string;
  providerId: number;
  model: string;
  type: string;
  capabilities: string[];
  /** Toolgate upstream name (route rule); only sent by a Core that forwards it (MUYU-365 gap2). Absent = unknown. */
  upstream?: string;
  /** MUYU-418 contract v1, absent on an older Core: true / false (with `unavailableReason`) / null = not probed. */
  available?: boolean | null;
  unavailableReason?: string | null;
  probedAt?: string | null;
  /** supported / unsupported / unverified (never guessed from the name). */
  vision_in?: string;
  visionEvidence?: { source: string; ref: string; testedAt: string | null } | null;
}

export interface TypedModelQuery {
  /** Also list route-disabled models (`available:false`), so a selector can grey them out with the reason. */
  includeUnavailable?: boolean;
}

export interface ModelCatalog {
  readonly listProviders: () => Promise<Provider[]>;
  readonly fetchVisibleModels: () => Promise<UserVisibleModel[]>;
  /** `null` = old Core (404) or no types synced yet (`typesAvailable:false`). */
  readonly listTypedModels: (type: ModelType, query?: TypedModelQuery) => Promise<TypedModel[] | null>;
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
export const listTypedModels = (type: ModelType, query?: TypedModelQuery): Promise<TypedModel[] | null> => (
  getModelCatalog().listTypedModels(type, query)
);

/** Every type's list, or `null` when the Core has no types (old Core). */
export async function listAllTypedModels(query?: TypedModelQuery): Promise<Record<ModelType, TypedModel[]> | null> {
  const lists = await Promise.all(MODEL_TYPES.map((type) => listTypedModels(type, query)));
  if (lists.some((list) => list === null)) return null;
  return Object.fromEntries(MODEL_TYPES.map((type, i) => [type, lists[i]])) as Record<ModelType, TypedModel[]>;
}
