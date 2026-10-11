import type { InjectionKey } from "vue";

export const revalidateAttachments: InjectionKey<() => void> = Symbol("revalidateAttachments");
