import { getDownloadUrl, getImageContent } from "../api/storage.ts";

function save(href: string, filename: string) {
  const anchor = Object.assign(document.createElement("a"), { href, download: filename, style: "display:none" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * The one download path of a stored file (AttachmentChips.vue and the React island): images from
 * verified Storage bytes and filenames, other files through the validated signed URL (blob
 * download, or a new no-opener tab when the CDN has no CORS).
 */
export async function downloadStoredFile(id: string, name: string, image: boolean): Promise<void> {
  if (image) {
    const { blob, filename } = await getImageContent(id);
    const url = URL.createObjectURL(blob);
    try { save(url, filename); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    return;
  }
  const url = await getDownloadUrl(id);
  let objectUrl = "";
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download returned ${response.status}`);
    objectUrl = URL.createObjectURL(await response.blob());
    save(objectUrl, name || "attachment");
  } catch {
    // The signed URL is still safe (validated by getDownloadUrl), so fall back to a new tab.
    window.open(url, "_blank", "noopener,noreferrer");
  } finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
