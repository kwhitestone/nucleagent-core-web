<script setup lang="ts">
/**
 * Error block that replaces the skeleton when a generation fails.
 * Copy is verbatim from UI-DESIGN-3 §3.3 (title / body / buttons / charge note).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { AlertCircle, AlertTriangle, Ban } from "@lucide/vue";

type ErrorCode = "content_rejected" | "insufficient_balance" | "media_busy" | "timeout" | "failed" | "cancelled";
type ButtonKind = "retry" | "switchModel" | "editPrompt" | "viewUsage" | "viewRunning";

// submitted defaults to undefined (unknown), not Vue's absent-Boolean false.
const props = withDefaults(defineProps<{
  code: ErrorCode;
  message?: string;
  /** media_busy: number of running jobs. */
  n?: number;
  /** cancelled: whether the job had already reached the model (charged). */
  submitted?: boolean;
}>(), { submitted: undefined });

// `retry` covers retry/regenerate; every other button reports its kind via `action`.
const emit = defineEmits<{ retry: []; action: [kind: ButtonKind] }>();

// Chinese originals (§3.3); host i18n keys win when present (chatGen.errors.* reuses the main-line keys).
const FALLBACK: Record<string, string> = {
  "chatGen.errors.upstream_error.title": "生成没有成功",
  "chatGen.errors.upstream_error.body": "生成服务出错，请稍后重试。",
  "chatGen.errors.upstream_timeout.title": "等太久了，没拿到结果",
  "chatGen.errors.upstream_timeout.body": "生成超时，未拿到结果。可以换个模型或简化描述再试。",
  "chatGen.errors.content_rejected.title": "内容没有通过安全审核",
  "chatGen.errors.content_rejected.body": "提示词或结果未通过内容安全审核，请修改后重试。",
  "chatGen.errors.insufficient_balance.title": "贝壳不够了",
  "chatGen.errors.insufficient_balance.body": "账户额度不足，请联系管理员。",
  "chatGen.busy": "你已有 {n} 个生成任务在进行（图片最多 4 个、视频最多 2 个），等其中一个完成后再试。",
  "chatGen.cancelledTitle": "已取消",
  "chatGen.cancelledBody": "未产出结果",
  "chatGen.cancelledFree": "不会扣费",
  "chatGen.cancelledCharged": "已提交的部分按实际扣费，以用量明细为准",
  "chatGen.charge.label": "扣费：{s}",
  "chatGen.charge.mostlyFree": "一般不扣（以用量明细为准）",
  "chatGen.charge.byLedger": "以用量明细为准",
  "chatGen.charge.free": "不扣",
  "chatGen.retry": "重试",
  "chatGen.regenerate": "重新生成",
  "chatGen.switchModel": "换个模型",
  "chatGen.editPrompt": "修改提示词",
  "chatGen.viewUsage": "查看用量",
  "chatGen.viewRunning": "查看进行中",
};
const { t, te } = useI18n();
function tr(key: string, params: Record<string, unknown> = {}): string {
  if (te(key)) return t(key, params);
  return (FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

interface Spec { titleKey?: string; bodyKey: string; charge?: string; buttons: { kind: ButtonKind; label: string }[]; tone: "error" | "warn" | "muted" }
const SPECS: Record<ErrorCode, Spec> = {
  failed: { titleKey: "chatGen.errors.upstream_error.title", bodyKey: "chatGen.errors.upstream_error.body", charge: "chatGen.charge.mostlyFree", buttons: [{ kind: "retry", label: "chatGen.retry" }], tone: "error" },
  timeout: { titleKey: "chatGen.errors.upstream_timeout.title", bodyKey: "chatGen.errors.upstream_timeout.body", charge: "chatGen.charge.byLedger", buttons: [{ kind: "retry", label: "chatGen.retry" }, { kind: "switchModel", label: "chatGen.switchModel" }], tone: "error" },
  // Charge for rejected content is unconfirmed (§3.3): never claim it is free.
  content_rejected: { titleKey: "chatGen.errors.content_rejected.title", bodyKey: "chatGen.errors.content_rejected.body", buttons: [{ kind: "editPrompt", label: "chatGen.editPrompt" }], tone: "error" },
  insufficient_balance: { titleKey: "chatGen.errors.insufficient_balance.title", bodyKey: "chatGen.errors.insufficient_balance.body", charge: "chatGen.charge.free", buttons: [{ kind: "viewUsage", label: "chatGen.viewUsage" }], tone: "warn" },
  // Busy is an amber strip above the composer, no title (§3.3).
  media_busy: { bodyKey: "chatGen.busy", charge: "chatGen.charge.free", buttons: [{ kind: "viewRunning", label: "chatGen.viewRunning" }], tone: "warn" },
  cancelled: { titleKey: "chatGen.cancelledTitle", bodyKey: "chatGen.cancelledBody", buttons: [{ kind: "retry", label: "chatGen.regenerate" }], tone: "muted" },
};

const spec = computed(() => SPECS[props.code] ?? SPECS.failed);
const title = computed(() => (spec.value.titleKey ? tr(spec.value.titleKey) : ""));
const body = computed(() => props.message || tr(spec.value.bodyKey, { n: props.n ?? 1 }));
const charge = computed(() => {
  // Unknown (reopened conversation): never guess the charge.
  if (props.code === "cancelled") return props.submitted === undefined ? "" : tr(props.submitted ? "chatGen.cancelledCharged" : "chatGen.cancelledFree");
  return spec.value.charge ? tr("chatGen.charge.label", { s: tr(spec.value.charge) }) : "";
});
const buttons = computed(() => spec.value.buttons);
const icon = computed(() => (spec.value.tone === "warn" ? AlertTriangle : spec.value.tone === "muted" ? Ban : AlertCircle));

function press(kind: ButtonKind) {
  if (kind === "retry") emit("retry");
  else emit("action", kind);
}
</script>

<template>
  <div :class="['gen-error', `is-${spec.tone}`]" role="alert">
    <component :is="icon" class="gen-error__icon" :size="18" aria-hidden="true" />
    <div class="gen-error__main">
      <p v-if="title" class="gen-error__title">{{ title }}</p>
      <p class="gen-error__body">{{ body }}</p>
      <p v-if="charge" class="gen-error__charge">{{ charge }}</p>
      <div class="gen-error__actions">
        <button v-for="b in buttons" :key="b.kind" type="button" class="gen-btn" @click="press(b.kind)">{{ tr(b.label) }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gen-error {
  display: flex; gap: 10px; max-width: 560px; padding: 12px 14px;
  border-radius: var(--r-lg); font-size: 13px;
  animation: fade-in 0.4s var(--ease-out) both;
}
.gen-error.is-error { background: #fef2f2; color: #dc2626; }
.gen-error.is-warn { background: #fffbeb; color: #b45309; }
.gen-error.is-muted { background: var(--bg-subtle); color: var(--text-secondary); }
.gen-error__icon { flex: none; margin-top: 1px; }
.gen-error__main { min-width: 0; }
.gen-error p { margin: 0; }
.gen-error__title { font-weight: 600; margin-bottom: 2px !important; }
.gen-error__charge { margin-top: 4px !important; font-size: 12px; color: var(--text-secondary); }
.gen-error__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.gen-btn {
  font: inherit; font-size: 13px; padding: 5px 12px; cursor: pointer;
  color: var(--text-primary); background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--r-md);
  transition: all 0.3s var(--ease);
}
.gen-btn:hover { border-color: color-mix(in srgb, var(--atc-accent, #6366f1) 55%, var(--border)); }
@media (prefers-reduced-motion: reduce) { .gen-error { animation: none; } }
</style>
