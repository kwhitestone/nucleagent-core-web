<script setup lang="ts">
/**
 * MUYU-365 thin host for the React chat island (plan §1.2 bridge 1–4). Auth, shell bridge,
 * router and sidebar store stay in Vue; React gets navigate/create/t as plain callbacks.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useConversationStore } from "@/addons/conversation/store/conversation";
import type { ChatProps } from "@/chat-react/ChatApp";

const props = defineProps<{ id?: string }>();
const el = ref<HTMLElement | null>(null);
const router = useRouter();
const store = useConversationStore();
const { t, locale } = useI18n();
let island: { update(p: ChatProps): void; unmount(): void } | undefined;
let disposed = false;

const chatProps = (): ChatProps => ({
  conversationId: props.id,
  t: (key, named) => t(key, named ?? {}),
  locale: locale.value === "en" ? "en-US" : "zh-CN",
  navigate: (path) => void router.push(path),
  create: (payload) => store.create(payload),
});

onMounted(async () => {
  const { mount } = await import("@/chat-react/mount");
  if (disposed || !el.value) return;
  island = mount(el.value, chatProps());
});
watch([() => props.id, locale], () => island?.update(chatProps()));
onBeforeUnmount(() => {
  disposed = true;
  island?.unmount();
});
</script>

<template>
  <div ref="el" class="view active view--scroll-hidden" data-chat-ui="react" />
</template>
