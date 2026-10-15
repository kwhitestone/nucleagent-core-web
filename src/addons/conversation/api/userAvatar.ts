/**
 * User-side agent avatar upload (U8). Kept apart from the admin route on purpose.
 *
 * CONTRACT — the single place to edit once the U8 backend lands. Assumed, not yet confirmed:
 * core feat/user-agent-impl (3b9a7b6) has /api/v1/addons/agent/mine/definitions[/{id}] but no avatar route.
 * Field, types and limits copy the live admin route (admin/router/agent_avatar.go: POST
 * /api/v1/addons/admin/agents/avatar, field "file", png|jpeg, ≤2MB, sides 1..4096 → {fileId, path}).
 * Foreign, missing and system ids answer the same 404 (★1).
 */
export const USER_AVATAR_CONTRACT = {
  confirmed: false,
  method: "POST",
  path: (id: number) => `/api/v1/addons/agent/mine/definitions/${id}/avatar`,
  field: "file",
  types: ["image/png", "image/jpeg"],
  maxBytes: 2 << 20,
  maxSide: 4096,
  pathPrefix: "/api/v1/avatars/",
} as const;

/** Mock of the response, same shape as the admin route; tests and local dev use this. */
export const mockUserAvatarResponse = (fileId: string) => ({ fileId, path: `${USER_AVATAR_CONTRACT.pathPrefix}${fileId}` });

/** Accepts the admin body, a {code,data} envelope, or `avatarUrl` (the U8 note's name) — whichever U8 ships. */
function avatarPath(body: unknown): string {
  const b = body as { data?: unknown } | null;
  const d = (b && typeof b === "object" && b.data && typeof b.data === "object" ? b.data : b) as { path?: unknown; avatarUrl?: unknown } | null;
  const path = d?.path ?? d?.avatarUrl;
  return typeof path === "string" && path.startsWith(USER_AVATAR_CONTRACT.pathPrefix) ? path : "";
}

export type AvatarErrorKind = "type" | "size" | "side" | "notFound" | "dailyLimit" | "failed";
export class AvatarUploadError extends Error {
  readonly kind: AvatarErrorKind;
  constructor(kind: AvatarErrorKind, message = "") { super(message); this.name = "AvatarUploadError"; this.kind = kind; }
}

export type Post = (path: string, body: FormData) => Promise<unknown>;
export type Dims = (file: File) => Promise<{ width: number; height: number }>;

/** Only definitions the caller created: core /mine sets `owned: true` (mine.go); system rows get false, older cores omit it → hidden. */
export const canUploadAvatar = (agent: { owned?: boolean }) => agent.owned === true;

/** Same type/size rules as the admin route; "" = ok. */
export function checkAvatarFile(file: File): "" | "type" | "size" {
  if (!(USER_AVATAR_CONTRACT.types as readonly string[]).includes(file.type)) return "type";
  return file.size > USER_AVATAR_CONTRACT.maxBytes ? "size" : "";
}

export async function uploadMyAgentAvatar(post: Post, id: number, file: File): Promise<string> {
  const form = new FormData();
  form.append(USER_AVATAR_CONTRACT.field, file);
  let body: unknown;
  try {
    body = await post(USER_AVATAR_CONTRACT.path(id), form);
  } catch (e) {
    // One fixed answer for 404: never echo server text that could tell foreign from missing.
    const err = e as { status?: unknown; message?: unknown } | null;
    if (err?.status === 404) throw new AvatarUploadError("notFound");
    // Core answers 429 with a machine code (user_avatar.go); show it as text. Any other 429 echoes as-is.
    if (err?.status === 429 && err.message === "user_avatar_daily_limit") throw new AvatarUploadError("dailyLimit");
    throw new AvatarUploadError("failed", e instanceof Error ? e.message : String(e));
  }
  const path = avatarPath(body);
  if (!path) throw new AvatarUploadError("failed", "unexpected avatar response");
  return path;
}

/** Validate locally, then upload; one flight at a time. Returns null when a flight is already running. */
export function avatarUploader(post: Post, dims: Dims, setBusy: (busy: boolean) => void) {
  let busy = false;
  return async (id: number, file: File): Promise<string | null> => {
    if (busy) return null;
    busy = true;
    setBusy(true);
    try {
      const bad = checkAvatarFile(file);
      if (bad) throw new AvatarUploadError(bad);
      const { width, height } = await dims(file).catch(() => { throw new AvatarUploadError("type"); });
      const max = USER_AVATAR_CONTRACT.maxSide;
      if (!(width > 0 && height > 0 && width <= max && height <= max)) throw new AvatarUploadError("side");
      return await uploadMyAgentAvatar(post, id, file);
    } finally {
      busy = false;
      setBusy(false);
    }
  };
}

/** Browser image size; decode failure counts as a wrong type. */
export const imageDims: Dims = async (file) => {
  const bitmap = await createImageBitmap(file);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
};

/** config.avatar holds a storage-relative path; the card needs the storage origin in front. */
export function storageAvatar(value: string | undefined, storageOrigin: string): string | undefined {
  return value?.startsWith(USER_AVATAR_CONTRACT.pathPrefix) && storageOrigin ? storageOrigin + value : value;
}
