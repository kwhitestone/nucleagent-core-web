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

  async listTypedModels(type, query) {
    const params = { type, pageSize: 100, ...(query?.includeUnavailable ? { includeUnavailable: 1 } : {}) };
    for (let attempt = 0; ; attempt++) {
      const models: TypedModel[] = [];
      let cursor: string | undefined;
      let sortVersion: string | undefined;
      try {
        do {
          const response = await getPlatformRuntime().http.get<Envelope<TypedModel[]> & {
            typesAvailable?: boolean; sortVersion?: string; nextCursor?: string;
          }>("/api/v1/addons/provider/models", {
            params: cursor ? { ...params, cursor, sortVersion } : params,
          });
          const page = response.data;
          if (!page?.typesAvailable) return null;
          models.push(...(page.data ?? []));
          if (cursor && page.sortVersion !== sortVersion) throw new Error("Catalog version changed within a page");
          sortVersion = page.sortVersion;
          cursor = page.nextCursor;
          if (cursor && (!sortVersion || cursor !== String(models.length) || !page.data?.length)) {
            throw new Error("Invalid catalog cursor");
          }
        } while (cursor);
        return models;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        if (!(cursor && attempt === 0 && error instanceof ApiError && error.status === 409)) throw error;
      }
    }
  },
};
