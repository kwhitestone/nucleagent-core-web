<script setup lang="ts">
// MUYU-410 task-desk title search, split out of Home.vue and loaded lazily (MUYU-365 batch 1 size budget).
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Conversation } from "@/addons/conversation/api/types";
import { listConversations } from "@/addons/conversation/api/conversation";
import { createTitleSearch } from "@/addons/conversation/composables/historySearch";
import { relativeTime } from "@/addons/conversation/composables/taskDesk";

defineProps<{ now: number }>();
const emit = defineEmits<{ open: [conversation: Conversation]; active: [searching: boolean] }>();
const { t, locale } = useI18n();
// Title search is its own Core-paged view (newest first); it never reorders the desk list.
const search = createTitleSearch((q, beforeId) => listConversations({ q, beforeId, limit: 20 }));
// Home hides its own recent list while the search view is shown (desk order is never touched).
watch(search.active, (on) => emit("active", on));
</script>

<template>
<input
  v-model="search.query.value"
  type="search"
  class="desk-search"
  data-testid="desk-search"
  maxlength="80"
  dir="auto"
  :placeholder="t('home.searchPlaceholder')"
  :aria-label="t('home.searchPlaceholder')"
  @keydown.esc="search.query.value = ''"
/>
<template v-if="search.active.value">
<p class="desk-glabel" aria-live="polite">{{ search.loading.value ? t('common.loading') : t('home.searchResults') }}</p>
<div v-if="search.results.value.length" class="desk-list" :aria-busy="search.loading.value">
  <button
    v-for="c in search.results.value"
    :key="c.id"
    type="button"
    class="desk-row"
    :data-status="c.status"
    data-testid="desk-row"
    @click="emit('open', c)"
  >
    <span class="desk-row-title" dir="auto">{{ c.title || t('common.untitled') }}</span>
    <span class="desk-row-meta">
      <i class="desk-dot" aria-hidden="true" />
      <span>{{ c.status === 'blocked' ? t('home.needsYou') : t(`broadcast.status.${c.status}`) }}</span>
      <time :datetime="c.createdAt">{{ relativeTime(c.createdAt, now, locale === 'en' ? 'en' : 'zh-CN') }}</time>
    </span>
  </button>
</div>
<p v-if="search.failed.value" class="desk-empty" role="alert">
  {{ t('home.searchFailed') }} <button type="button" class="desk-more" @click="search.retry()">{{ t('common.retry') }}</button>
</p>
<button v-else-if="search.hasMore.value && !search.loading.value" type="button" class="desk-more" data-testid="desk-search-more" @click="search.more()">{{ t('home.loadMore') }}</button>
<p v-else-if="!search.loading.value && !search.results.value.length" class="desk-empty">{{ t('home.searchEmpty') }}</p>
</template>
</template>

