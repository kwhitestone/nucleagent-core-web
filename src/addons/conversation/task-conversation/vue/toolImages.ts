import { isSealedToolLink } from "../../api/downloadUrlPolicy.ts";

interface ImageToken {
  type: string;
  content?: string;
  children?: ImageToken[] | null;
  attrGet?(name: string): string | null;
}

export interface ToolImage {
  src: string;
  alt: string;
}

/**
 * MUYU-342: markdown images stay stripped from the HTML; only images whose src is a
 * sealed tool-link ticket (`nlk.`) are listed, so the owner can unseal them through Core.
 */
export function collectToolImages(tokens: ImageToken[]): ToolImage[] {
  const images: ToolImage[] = [];
  const seen = new Set<string>();
  const walk = (list: ImageToken[]) => {
    for (const token of list) {
      if (token.type === "image") {
        const src = token.attrGet?.("src") ?? "";
        if (/^https:\/\//i.test(src) && isSealedToolLink(src) && !seen.has(src)) {
          seen.add(src);
          images.push({ src, alt: token.content ?? "" });
        }
      }
      if (token.children) walk(token.children);
    }
  };
  walk(tokens);
  return images;
}

/** The unsealed image must be an absolute https URL; anything else fails closed. */
export function assertToolImageUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("图片地址不安全");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("图片地址不安全");
  return parsed.href;
}

/** Download file name from the URL path, restricted to a safe image name. */
export function toolImageFilename(url: string, fallback = "image"): string {
  const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  return /^[\w.-]{1,120}\.(jpe?g|png|gif|webp)$/i.test(last) ? last : `${fallback}.png`;
}
