<script setup lang="ts">
/**
 * 附件 chip 列表。两种用法：
 *   - removable=true：composer 里的待发送附件；图片可预览/下载，所有附件可移除；
 *   - removable=false：消息气泡里的已发送附件；图片可预览，其他文件可下载。
 *
 * 为什么是独立组件而不是把 chip 拼进气泡 HTML：消息正文走 marked + DOMPurify
 * （Conversation.vue 的 renderMarkdown），DOMPurify 会剥掉未知属性和事件处理，
 * 注入的 chip 点不动。必须是真实 Vue 节点。
 */
import { useI18n } from "vue-i18n";
import { getDownloadUrl } from "@/addons/conversation/api/storage";
import { toast } from "@/composables/useToast";
import type { MessageAttachment } from "@/addons/conversation/api/types";
import ImageAttachmentPreview from "./ImageAttachmentPreview.vue";
import { formatAttachmentSize, isImageAttachment } from "./attachmentPresentation";

withDefaults(
  defineProps<{
    attachments: MessageAttachment[];
    removable?: boolean;
  }>(),
  { removable: false },
);

const emit = defineEmits<{ remove: [fileId: string] }>();

const { t } = useI18n();

/**
 * 点击下载时现取签名 URL（有效期 1800s），避免复用已经失效的缩略图地址。
 */
async function download(att: MessageAttachment): Promise<void> {
  try {
    const url = await getDownloadUrl(att.fileId);
    let objectUrl = "";
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download returned ${response.status}`);
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = att.name || "attachment";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      // Some third-party CDNs do not expose CORS headers. The signed URL is
      // still safe (validated by getDownloadUrl), so fall back to a new tab.
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  } catch {
    toast.error(t("common.attachmentDownloadFailed"));
  }
}
</script>

<template>
  <div v-if="attachments.length > 0" class="attachment-chips">
    <template v-for="att in attachments" :key="att.fileId">
      <ImageAttachmentPreview
        v-if="isImageAttachment(att)"
        :attachment="att"
        :removable="removable"
        @download="download(att)"
        @remove="emit('remove', att.fileId)"
      />
      <div v-else class="attachment-chip">
        <span class="att-icon" aria-hidden="true">
          <svg v-if="att.kind === 'image'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
        </span>
        <button class="att-name" type="button" :title="att.name" @click="download(att)">
          {{ att.name }}
        </button>
        <span v-if="att.size" class="att-size">{{ formatAttachmentSize(att.size) }}</span>
        <button
          v-if="removable"
          class="att-remove"
          type="button"
          :title="t('common.attachmentRemove')"
          @click="emit('remove', att.fileId)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.attachment-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 12.5px;
  font-family: var(--font-body);
}

.att-icon {
  display: inline-flex;
  color: var(--text-tertiary);
}

.att-icon svg {
  width: 14px;
  height: 14px;
}

.att-name {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-primary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: inherit;
}

.att-name:hover {
  color: var(--teal-600);
  text-decoration: underline;
}

.att-size {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.att-remove {
  display: inline-flex;
  background: none;
  border: none;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.att-remove:hover {
  color: var(--rose-500);
}

.att-remove svg {
  width: 13px;
  height: 13px;
}
</style>
