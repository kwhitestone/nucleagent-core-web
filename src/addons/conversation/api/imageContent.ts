interface DownloadSession {
  getAccessToken(): string | null;
  getSessionVersion(): number;
  handleUnauthorizedResponse(authorization?: string): void;
}

const extensions: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
};
const maxBytes = 100 * 1024 * 1024;

/** Only the authenticated Storage endpoint may supply image bytes/filenames. */
export async function fetchImageContent(
  base: string, fileId: string, session: DownloadSession, signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const token = session.getAccessToken();
  const version = session.getSessionVersion();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const assertCurrent = () => {
    if (token !== session.getAccessToken() || version !== session.getSessionVersion()) cancel();
    controller.signal.throwIfAborted();
  };
  if (!token) throw new Error("Authentication required");
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  globalThis.addEventListener?.("nucleagent:session-change", cancel);
  const timeout = setTimeout(cancel, 45000);
  try {
    assertCurrent();
    const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/files/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: token, "X-Namespace": "core" },
      signal: controller.signal, redirect: "error", cache: "no-store", credentials: "omit",
    });
    assertCurrent();
    if (response.status === 401) session.handleUnauthorizedResponse(token);
    if (!response.ok) throw new Error("Image download failed");
    const mime = response.headers.get("Content-Type") || "";
    const extension = extensions[mime];
    const size = Number(response.headers.get("Content-Length"));
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = /^attachment; filename\*=utf-8''([^;]+)$/i.exec(disposition);
    const plain = /^attachment; filename=(?:"([^"\\]+)"|([^;"\s]+))$/i.exec(disposition);
    const filename = encoded ? decodeURIComponent(encoded[1]) : plain?.[1] || plain?.[2] || "";
    if (!extension || !filename.endsWith(extension) || /[/\\\u0000-\u001f\u007f]/.test(filename) ||
        !Number.isSafeInteger(size) || size <= 0 || size > maxBytes || !response.body) {
      controller.abort();
      throw new Error("Invalid image response");
    }
    const reader = response.body.getReader();
    const parts: BlobPart[] = [];
    let received = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        assertCurrent();
        if (done) break;
        received += value.byteLength;
        if (received > size) throw new Error("Image exceeds declared length");
        parts.push(new Uint8Array(value));
      }
      if (received !== size) throw new Error("Truncated image");
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    assertCurrent();
    return { blob: new Blob(parts, { type: mime }), filename };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    globalThis.removeEventListener?.("nucleagent:session-change", cancel);
  }
}
