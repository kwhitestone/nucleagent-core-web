/**
 * Validate a storage-provided download target before it reaches window.open.
 * Only absolute HTTP(S) URLs are valid; executable and local schemes fail closed.
 */
export function assertSafeDownloadUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("下载地址不安全");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("下载地址不安全");
  }
  return raw;
}
