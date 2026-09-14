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

export interface ModelCatalog {
  readonly listProviders: () => Promise<Provider[]>;
  readonly fetchVisibleModels: () => Promise<UserVisibleModel[]>;
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
