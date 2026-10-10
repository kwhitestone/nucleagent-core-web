// MT3-coreweb: Core media generation API (app/src/server/addons/media, core 9c0c74a).
// Relative imports: loaded natively by node --test.
import { getPlatformRuntime } from "../../../contracts/platform-runtime.ts";
import { assertSafeDownloadUrl } from "./downloadUrlPolicy.ts";
import type { GenerationKind, GenerationTask, MediaModel } from "../composables/generation.ts";

const BASE = "/api/v1/addons/media";
const http = () => getPlatformRuntime().http;

/** Models of this kind in the family allow-list ∩ `?type=`; [] on an old sync (`typesAvailable:false`). */
export async function listMediaModels(kind: GenerationKind): Promise<MediaModel[]> {
  const res = await http().get<{ data?: MediaModel[] }>(`${BASE}/models`, { params: { kind } });
  return res.data?.data ?? [];
}

export async function createGeneration(body: { kind: GenerationKind; providerId: number; model: string; prompt: string }): Promise<{ id: number; status: string }> {
  const res = await http().post<{ id: number; status: string }>(`${BASE}/generations`, body);
  return res.data;
}

/** The caller's own tasks (Core filters by user). */
export async function listGenerations(kind: GenerationKind): Promise<GenerationTask[]> {
  const res = await http().get<{ data?: GenerationTask[] }>(`${BASE}/generations`, { params: { kind } });
  return res.data?.data ?? [];
}

export async function getGeneration(id: number): Promise<GenerationTask> {
  const res = await http().get<GenerationTask>(`${BASE}/generations/${id}`);
  return res.data;
}

/** A fresh signed link on every call (Core signs per GET; never cached here). */
export async function freshDownloadUrl(id: number): Promise<string> {
  const task = await getGeneration(id);
  if (!task.downloadUrl) throw new Error("no download url");
  return assertSafeDownloadUrl(task.downloadUrl);
}
