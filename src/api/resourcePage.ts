import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { PageParams, PageResult } from "@/composables/useRemotePage";

export type ResourceFilter = Partial<PageParams> & {
  ids?: number[];
  group?: string;
  skillId?: number;
  toolId?: number;
  bound?: "all" | "yes" | "no";
  directory?: string;
};

export async function resourcePage<T>(path: string, params: ResourceFilter = {}, signal?: AbortSignal): Promise<PageResult<T>> {
  const response = await getPlatformRuntime().http.get<PageResult<T>>(path, {
    params: { page: 1, pageSize: 20, ...params, ids: params.ids?.join(",") },
    signal,
  });
  return validatePage(response.data);
}

export function validatePage<T>(result: PageResult<T>): PageResult<T> {
  if (!Array.isArray(result?.data) || !Number.isSafeInteger(result.total) || result.total < 0
    || !Number.isSafeInteger(result.page) || result.page < 1 || !Number.isSafeInteger(result.pageSize)
    || result.pageSize < 1 || result.pageSize > 100 || typeof result.hasMore !== "boolean") {
    throw new Error("Invalid paginated resource response");
  }
  return result;
}
