export interface CreateProviderRequest {
  name: string;
  apiKey: string;
  config?: import("@/contracts/model-catalog").ProviderConfig;
  isActive: boolean;
}

export interface UpdateProviderRequest {
  name?: string;
  apiKey?: string;
  config?: import("@/contracts/model-catalog").ProviderConfig;
  isActive?: boolean;
}

export interface Skill {
  id: number;
  name: string;
  slug: string;
  config?: Record<string, unknown>;
  i18n?: Record<string, unknown>;
  isActive: boolean;
  version?: string;
  sourceSha256?: string;
  createdAt?: string;
  updatedAt?: string;
}
