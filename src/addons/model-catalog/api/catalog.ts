import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import type {
  ModelCatalog,
  Provider,
  TypedModel,
  UserVisibleModel,
} from "@/contracts/model-catalog";

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export const modelCatalog: ModelCatalog = {
  async listProviders(): Promise<Provider[]> {
    const response = await getPlatformRuntime().http.get<Envelope<Provider[]>>(
      "/api/v1/addons/provider",
    );
    return response.data?.data ?? [];
  },

  async fetchVisibleModels(): Promise<UserVisibleModel[]> {
    const response = await getPlatformRuntime().http.get<Envelope<UserVisibleModel[]>>(
      "/api/v1/addons/provider/visible-models",
    );
    return response.data?.data ?? [];
  },

  async listTypedModels(type) {
    try {
      const response = await getPlatformRuntime().http.get<Envelope<TypedModel[]> & { typesAvailable?: boolean }>(
        "/api/v1/addons/provider/models", { params: { type } },
      );
      return response.data?.typesAvailable ? response.data.data ?? [] : null;
    } catch (error) {
      // Old Core has no such route: callers fall back to config.models.
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
};
