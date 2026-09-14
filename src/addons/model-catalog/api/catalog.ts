import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type {
  ModelCatalog,
  Provider,
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
};
