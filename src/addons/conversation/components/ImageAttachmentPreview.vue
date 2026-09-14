<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getDownloadUrl } from "@/addons/conversation/api/storage";
import type { MessageAttachment } from "@/addons/conversation/api/types";
import { formatAttachmentSize } from "./attachmentPresentation";

const props = withDefaults(
  defineProps<{ attachment: MessageAttachment; removable?: boolean }>(),
  { removable: false },
);
const emit = defineEmits<{ download: []; remove: [] }>();
const { t } = useI18n();

const attachmentRoot = ref<HTMLElement | null>(null);
const thumbnailButton = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const imageUrl = ref("");
const loadState = ref<"loading" | "ready" | "error">("loading");
const previewOpen = ref(false);

let requestVersion = 0;
let imageRefreshes = 0;
let previousBodyOverflow = "";
let visibilityObserver: IntersectionObserver | null = null;

async function loadImage(force = false): Promise<void> {
  if (imageUrl.value && !force) return;
  const version = ++requestVersion;
  loadState.value = "loading";
  try {
    const url = await getDownloadUrl(props.attachment.fileId);
    if (version !== requestVersion) return;
    imageUrl.value = url;
    loadState.value = "ready";
  } catch {
    if (version !== requestVersion) return;
    imageUrl.value = "";
    loadState.value = "error";
  }
}

async function openPreview(): Promise<void> {
  previewOpen.value = true;
  if (!imageUrl.value) void loadImage(true);
  await nextTick();
  closeButton.value?.focus();
}

async function closePreview(): Promise<void> {
  if (!previewOpen.value) return;
  previewOpen.value = false;
  await nextTick();
  thumbnailButton.value?.focus();
}

function retryPreview(): void {
  imageRefreshes = 0;
  void loadImage(true);
}

function handleImageError(): void {
  if (imageRefreshes < 1) {
    imageRefreshes += 1;
    imageUrl.value = "";
    void loadImage(true);
    return;
  }
  imageUrl.value = "";
  loadState.value = "error";
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    void closePreview();
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function loadWhenNearViewport(): void {
  if (typeof window === "undefined" || !attachmentRoot.value) return;
  if (!("IntersectionObserver" in window)) {
    void loadImage();
    return;
  }
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      visibilityObserver?.disconnect();
      visibilityObserver = null;
      void loadImage();
    },
    { rootMargin: "240px 0px" },
  );
  visibilityObserver.observe(attachmentRoot.value);
}

watch(previewOpen, (open) => {
  if (typeof document === "undefined") return;
  if (open) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = previousBodyOverflow;
  }
});

onMounted(loadWhenNearViewport);
onBeforeUnmount(() => {
  requestVersion += 1;
  visibilityObserver?.disconnect();
  visibilityObserver = null;
  if (typeof document !== "undefined" && previewOpen.value) {
    document.body.style.overflow = previousBodyOverflow;
  }
});
</script>

<template>
  <div
    ref="attachmentRoot"
    :class="['image-attachment', { removable }]"
    :data-attachment-id="attachment.fileId"
  >
    <button
      ref="thumbnailButton"
      class="image-attachment-thumb"
      type="button"
      aria-haspopup="dialog"
      :aria-label="t('common.attachmentPreview', { name: attachment.name })"
      @click="openPreview"
    >
      <img
        v-if="imageUrl"
        :src="imageUrl"
        :alt="attachment.name"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="handleImageError"
      />
      <span v-else-if="loadState === 'loading'" class="image-placeholder" aria-live="polite">
        <span class="image-spinner" aria-hidden="true" />
        {{ t('common.attachmentPreviewLoading') }}
      </span>
      <span v-else class="image-placeholder image-placeholder-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /><path d="m14 8 3 3" /></svg>
        {{ t('common.attachmentPreviewFailed') }}
      </span>
      <span class="image-expand" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
      </span>
    </button>
    <div class="image-attachment-meta">
      <span class="image-name" :title="attachment.name">{{ attachment.name }}</span>
      <span v-if="attachment.size" class="image-size">{{ formatAttachmentSize(attachment.size) }}</span>
      <button
        v-if="removable"
        class="image-attachment-remove"
        type="button"
        :aria-label="`${t('common.attachmentRemove')}: ${attachment.name}`"
        @click.stop="emit('remove')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="previewOpen"
      class="image-preview-overlay"
      @click.self="closePreview"
      @keydown="handleDialogKeydown"
    >
      <section
        ref="dialog"
        class="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('common.attachmentPreview', { name: attachment.name })"
      >
        <header class="image-preview-header">
          <div class="image-preview-title">
            <span class="image-preview-name" :title="attachment.name">{{ attachment.name }}</span>
            <span v-if="attachment.size">{{ formatAttachmentSize(attachment.size) }}</span>
          </div>
          <button
            ref="closeButton"
            class="image-preview-close"
            type="button"
            :aria-label="t('common.close')"
            @click="closePreview"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div class="image-preview-stage">
          <img
            v-if="imageUrl"
            :src="imageUrl"
            :alt="attachment.name"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="handleImageError"
          />
          <div v-else-if="loadState === 'loading'" class="image-preview-status" aria-live="polite">
            <span class="image-spinner" aria-hidden="true" />
            {{ t('common.attachmentPreviewLoading') }}
          </div>
          <div v-else class="image-preview-status">
            <span>{{ t('common.attachmentPreviewFailed') }}</span>
            <button type="button" class="image-retry" @click="retryPreview">
              {{ t('common.retry') }}
            </button>
          </div>
        </div>

        <footer class="image-preview-footer">
          <button class="image-download" type="button" @click="emit('download')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
            {{ t('common.attachmentDownload') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.image-attachment {
  width: min(220px, 62vw);
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 30%);
  border-radius: 10px;
  background: rgb(255 255 255 / 14%);
}

.image-attachment.removable {
  width: min(160px, 52vw);
  border-color: var(--border);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

.image-attachment.removable .image-attachment-thumb { height: 92px; }

.image-attachment-thumb {
  position: relative;
  display: block;
  width: 100%;
  height: 128px;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: rgb(15 23 42 / 20%);
  cursor: zoom-in;
}

.image-attachment-thumb:focus-visible,
.image-attachment-remove:focus-visible,
.image-preview-close:focus-visible,
.image-download:focus-visible,
.image-retry:focus-visible {
  outline: 2px solid var(--indigo-400);
  outline-offset: 2px;
}

.image-attachment-thumb img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  transition: transform 0.25s var(--ease);
}

.image-attachment-thumb:hover img { transform: scale(1.025); }

.image-placeholder {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgb(255 255 255 / 82%);
  font-size: 12px;
}

.image-placeholder-error svg { width: 22px; height: 22px; }

.image-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: image-spin 0.8s linear infinite;
}

.image-expand {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 8px;
  color: #fff;
  background: rgb(15 23 42 / 56%);
  backdrop-filter: blur(6px);
}

.image-expand svg { width: 14px; height: 14px; }

.image-attachment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px 7px;
  color: #fff;
  font-size: 11.5px;
}

.image-attachment.removable .image-attachment-meta { color: var(--text-primary); }

.image-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-size { flex-shrink: 0; color: rgb(255 255 255 / 72%); }
.image-attachment.removable .image-size { color: var(--text-tertiary); }

.image-attachment-remove {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--text-tertiary);
  background: transparent;
  cursor: pointer;
}

.image-attachment-remove:hover { color: var(--rose-500); background: var(--bg-hover); }
.image-attachment-remove svg { width: 14px; height: 14px; }

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(15 23 42 / 72%);
  backdrop-filter: blur(12px);
  animation: image-fade-in 0.18s var(--ease-out) both;
}

.image-preview-dialog {
  display: flex;
  width: min(1080px, 94vw);
  max-height: 92vh;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: var(--r-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-xl);
  animation: fade-in-up 0.24s var(--ease-out) both;
}

.image-preview-header,
.image-preview-footer {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-card);
}

.image-preview-header { justify-content: space-between; border-bottom: 1px solid var(--border); }

.image-preview-title {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 10px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.image-preview-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-preview-close {
  display: grid;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  place-items: center;
  border: 0;
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.image-preview-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.image-preview-close svg { width: 18px; height: 18px; }

.image-preview-stage {
  display: grid;
  min-height: 280px;
  flex: 1;
  place-items: center;
  overflow: auto;
  padding: 18px;
  background: #0f172a;
}

.image-preview-stage img {
  display: block;
  max-width: 100%;
  max-height: calc(92vh - 138px);
  object-fit: contain;
}

.image-preview-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #cbd5e1;
}

.image-retry {
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: var(--r-sm);
  padding: 5px 10px;
  color: #fff;
  background: rgb(255 255 255 / 10%);
  cursor: pointer;
}

.image-preview-footer { justify-content: flex-end; border-top: 1px solid var(--border); }

.image-download {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: var(--r-sm);
  padding: 8px 14px;
  color: #fff;
  background: linear-gradient(135deg, var(--indigo-500), var(--violet-500));
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.image-download:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.image-download svg { width: 16px; height: 16px; }

@keyframes image-spin { to { transform: rotate(360deg); } }
@keyframes image-fade-in { from { opacity: 0; } to { opacity: 1; } }

@media (max-width: 640px) {
  .image-preview-overlay { padding: 10px; }
  .image-preview-dialog { width: 100%; max-height: 96vh; }
  .image-preview-stage { min-height: 220px; padding: 10px; }
  .image-preview-stage img { max-height: calc(96vh - 138px); }
}

@media (prefers-reduced-motion: reduce) {
  .image-attachment-thumb img,
  .image-preview-overlay,
  .image-preview-dialog { animation: none; transition: none; }
}
</style>
