import { getPlatformRuntime } from "../../../contracts/platform-runtime";
import { configValue } from "../../../runtimeConfig";

export interface OwnedFile {
  fileId: string;
  origName: string;
  mimeType: string;
  size: number;
  status: string;
  createdBy: string;
}

export async function listOwnedFiles(offset: number, signal: AbortSignal): Promise<{ items: OwnedFile[]; hasMore: boolean }> {
  const session = getPlatformRuntime();
  const token = session.getAccessToken();
  const version = session.getSessionVersion();
  if (!token) throw new Error();
  const response = await session.http.get(`${configValue("VITE_STORAGE_URL")}/api/v1/files?limit=50&offset=${offset}`, {
    headers: { "X-Namespace": "core" }, signal,
  });
  const body = response.data;
  signal.throwIfAborted();
  const page = body?.data;
  if (token !== session.getAccessToken() || version !== session.getSessionVersion() || body?.code !== 0 ||
      !/^user:[1-9][0-9]*$/.test(page?.owner ?? "") || !Array.isArray(page.items) || page.items.length > 50 || typeof page.hasMore !== "boolean") throw new Error();
  const items = page.items.map((file: OwnedFile) => {
    if (!file || file.createdBy !== page.owner || !/^[a-zA-Z0-9_-]{1,128}$/.test(file.fileId) ||
        typeof file.origName !== "string" || typeof file.mimeType !== "string" || typeof file.status !== "string" || !Number.isSafeInteger(file.size)) throw new Error();
    return { fileId: file.fileId, origName: file.origName, mimeType: file.mimeType, size: file.size, status: file.status, createdBy: file.createdBy };
  });
  return { items, hasMore: page.hasMore };
}
