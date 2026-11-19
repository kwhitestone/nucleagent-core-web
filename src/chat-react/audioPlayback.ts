import type { FileChip } from "./attachments.ts";
import { sha256Hex } from "../addons/conversation/api/fileDigest.ts";

export async function readAudioBlob(file: FileChip, signal: AbortSignal, resolve: (id: string) => Promise<string>, read: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<Blob> {
  if (!file.verified || file.mimeType !== "audio/wav" || !file.size || file.size < 44 || file.size > 65536 || !file.sha256 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Audio unavailable");
  signal.throwIfAborted();
  const url = await resolve(file.id);
  signal.throwIfAborted();
  const response = await read(url, { credentials: "omit", redirect: "error", signal });
  if (!response.ok || !response.body || !/^audio\/(?:x-)?wav(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Audio unavailable");
  const reader = response.body.getReader();
  const data = new Uint8Array(file.size);
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      if (size + next.value.length > data.length) throw new Error("Audio unavailable");
      data.set(next.value, size); size += next.value.length;
    }
  } finally { await reader.cancel(); }
  const blob = new Blob([data], { type: "audio/wav" });
  const hash = await sha256Hex(blob);
  signal.throwIfAborted();
  if (size !== file.size || hash !== file.sha256) throw new Error("Audio unavailable");
  return blob;
}
