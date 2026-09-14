<script setup lang="ts">
/**
 * 默认模型管理 —— agentia DefaultLLMSettings 的 Aurora 移植。
 *
 * 两层配置（后端 defaultllm/service.go）：
 *   v1 简单模式：单一 provider×model；
 *   v2 模式组：quick/thinking/expert 三模式 → 模型组（用户可见的选项）→
 *     组内 Profiles（具体 provider×model 落点，组解析恒落 defaultProfileId）。
 * 解析优先级 v2 > v1 > first-available；v2 未配置时 v1 生效。
 *
 * 编辑语义：
 *   - 保存 v2 = PUT modeConfig（normalize 后端做，前端只保证结构完整）；
 *   - 保存 v1 = PUT providerId+model（仅在 v2 未启用时生效，保存后顶部状态
 *     会如实显示 source=mode_config —— 管理员据此理解为什么改了没变化）；
 *   - 清除 = DELETE（v1+v2 全清，回到自动回退）。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import {
  clearDefaultLLM,
  fetchDefaultLLM,
  updateDefaultLLM,
  type DefaultLLMModeConfig,
  type DefaultLLMModeKey,
  type DefaultLLMResponse,
  type LLMModelGroup,
  type LLMModelProfile,
} from "../../api/admin";
import { listProviders, type Provider } from "@/contracts/model-catalog";
import { toast } from "@/composables/useToast";

const { t } = useI18n();

const loading = ref(false);
const saving = ref(false);
const clearing = ref(false);
const state = ref<DefaultLLMResponse | null>(null);
const providers = ref<Provider[]>([]);

/** v2 编辑器状态（从 state.modeConfig 深拷贝，保存前不落库）。 */
const draft = ref<DefaultLLMModeConfig | null>(null);
const activeMode = ref<DefaultLLMModeKey>("quick");
/** 选中待查看/编辑的组 id（"" = 无选中，显示组列表）。 */
const selectedGroupId = ref("");
/** Profile 的 params JSON 草稿（id → 文本），失焦校验。 */
const profileParamsDrafts = ref<Record<string, string>>({});

const MODE_KEYS: DefaultLLMModeKey[] = ["quick", "thinking", "expert"];

function emptyModeConfig(): DefaultLLMModeConfig {
  return {
    version: 2,
    modes: { quick: {}, thinking: {}, expert: {} },
    groups: [],
    profiles: [],
  };
}

/** provider×model 扁平选项（下拉用）：{key,label,providerId,model}。 */
interface ModelOption {
  key: string;
  label: string;
  providerId: number;
  model: string;
}

const modelOptions = computed<ModelOption[]>(() => {
  const out: ModelOption[] = [];
  for (const p of providers.value) {
    if (!p.isActive) continue;
    const models = Array.isArray(p.config?.models) ? p.config.models : [];
    for (const m of models) {
      if (typeof m !== "string" || !m) continue;
      out.push({
        key: `${p.id}:${m}`,
        label: `${p.name} / ${m}`,
        providerId: p.id,
        model: m,
      });
    }
  }
  return out;
});

function optionFor(providerId: number, model: string): string {
  return `${providerId}:${model}`;
}

function profileById(id: string): LLMModelProfile | undefined {
  return draft.value?.profiles.find((p) => p.id === id);
}

const sourceLabel = computed(() => {
  const source = state.value?.source ?? "fallback";
  return t(`admin.defaultModel.source.${source}`);
});

/** 生效 provider 的显示名（模板里做空值收敛太啰嗦，computed 一次）。 */
const effectiveProviderName = computed(() => {
  const eff = state.value?.effective;
  if (!eff) return "";
  return providers.value.find((p) => p.id === eff.providerId)?.name ?? `#${eff.providerId}`;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [st, provs] = await Promise.all([fetchDefaultLLM(), listProviders()]);
    state.value = st;
    providers.value = provs;
    draft.value = st.modeConfig
      ? JSON.parse(JSON.stringify(st.modeConfig)) as DefaultLLMModeConfig
      : emptyModeConfig();
    selectedGroupId.value = "";
    profileParamsDrafts.value = {};
    for (const p of draft.value.profiles) {
      profileParamsDrafts.value[p.id] = p.params ? JSON.stringify(p.params, null, 2) : "";
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("admin.defaultModel.loadFailed"));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ---- v2 组/Profile 编辑 ----

let groupSeq = 0;
let profileSeq = 0;

function newGroupId(): string {
  return `g-${Date.now().toString(36)}-${groupSeq++}`;
}
function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${profileSeq++}`;
}

function addGroup(): void {
  if (!draft.value) return;
  const id = newGroupId();
  draft.value.groups.push({
    id,
    slug: `group-${draft.value.groups.length + 1}`,
    name: t("admin.defaultModel.newGroupName"),
    enabled: true,
    modeKeys: [activeMode.value],
    profileIds: [],
    defaultProfileId: "",
    sortOrder: draft.value.groups.length,
  });
  selectedGroupId.value = id;
}

function removeGroup(id: string): void {
  if (!draft.value) return;
  // 引用清理：modes 的 defaultGroupId、组内 profileIds 由后端 validate 兜底，
  // 这里先做能做的（删组时清 defaultGroupId 引用）。
  for (const mode of MODE_KEYS) {
    if (draft.value.modes[mode]?.defaultGroupId === id) {
      draft.value.modes[mode] = { ...draft.value.modes[mode], defaultGroupId: "" };
    }
  }
  draft.value.groups = draft.value.groups.filter((g) => g.id !== id);
  if (selectedGroupId.value === id) selectedGroupId.value = "";
}

function moveGroup(id: string, dir: -1 | 1): void {
  if (!draft.value) return;
  const idx = draft.value.groups.findIndex((g) => g.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= draft.value.groups.length) return;
  const groups = draft.value.groups;
  [groups[idx], groups[target]] = [groups[target], groups[idx]];
  // sortOrder 顺带重排，保持与显示顺序一致。
  groups.forEach((g, i) => (g.sortOrder = i));
}

function addProfileToGroup(groupId: string): void {
  if (!draft.value) return;
  const group = draft.value.groups.find((g) => g.id === groupId);
  const first = modelOptions.value[0];
  if (!group || !first) {
    toast.warning(t("admin.defaultModel.noModels"));
    return;
  }
  const id = newProfileId();
  draft.value.profiles.push({
    id,
    providerId: first.providerId,
    model: first.model,
    displayName: "",
    enabled: true,
  });
  group.profileIds.push(id);
  if (!group.defaultProfileId) group.defaultProfileId = id;
  profileParamsDrafts.value[id] = "";
}

function removeProfile(groupId: string, profileId: string): void {
  if (!draft.value) return;
  const group = draft.value.groups.find((g) => g.id === groupId);
  if (!group) return;
  group.profileIds = group.profileIds.filter((id) => id !== profileId);
  if (group.defaultProfileId === profileId) {
    group.defaultProfileId = group.profileIds[0] ?? "";
  }
  draft.value.profiles = draft.value.profiles.filter((p) => p.id !== profileId);
  delete profileParamsDrafts.value[profileId];
}

/** 失焦校验并回写 params 草稿；非法时红框 + 错误 toast（不阻塞其它编辑）。 */
function commitParamsDraft(profile: LLMModelProfile): void {
  const raw = (profileParamsDrafts.value[profile.id] ?? "").trim();
  if (!raw) {
    profile.params = null;
    return;
  }
  try {
    profile.params = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    toast.error(t("admin.defaultModel.invalidParamsJson", { name: profile.displayName || profile.id }));
  }
}

function setProfileModel(profile: LLMModelProfile, key: string): void {
  const [providerId, model] = key.split(":");
  profile.providerId = Number(providerId);
  profile.model = model;
}

function toggleModeKey(group: LLMModelGroup, mode: DefaultLLMModeKey): void {
  const idx = group.modeKeys.indexOf(mode);
  if (idx >= 0) {
    if (group.modeKeys.length > 1) group.modeKeys.splice(idx, 1);
  } else {
    group.modeKeys.push(mode);
  }
}

/** 该模式下的默认组下拉选项：所有 modeKeys 含此模式的组。 */
function groupsForMode(mode: DefaultLLMModeKey): LLMModelGroup[] {
  return (draft.value?.groups ?? []).filter((g) => g.modeKeys.includes(mode));
}

// ---- 保存 ----

async function saveV2(): Promise<void> {
  if (!draft.value || saving.value) return;
  // 先把所有 params 草稿回写（含未失焦的）。
  for (const p of draft.value.profiles) commitParamsDraft(p);
  saving.value = true;
  try {
    state.value = await updateDefaultLLM({ modeConfig: draft.value });
    toast.success(t("admin.defaultModel.saved"));
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  } finally {
    saving.value = false;
  }
}

// ---- v1 ----

const v1Selection = ref("");

async function saveV1(): Promise<void> {
  if (saving.value || !v1Selection.value) return;
  saving.value = true;
  try {
    const [providerId, model] = v1Selection.value.split(":");
    state.value = await updateDefaultLLM({ providerId: Number(providerId), model });
    toast.success(t("admin.defaultModel.saved"));
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  } finally {
    saving.value = false;
  }
}

async function clearAll(): Promise<void> {
  if (clearing.value) return;
  clearing.value = true;
  try {
    state.value = await clearDefaultLLM();
    toast.success(t("admin.defaultModel.cleared"));
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="dm-view">
    <!-- 当前生效卡 -->
    <div class="effective-card">
      <div class="effective-main">
        <div class="effective-title">{{ t("admin.defaultModel.effectiveTitle") }}</div>
        <template v-if="state?.effective">
          <div class="effective-value">
            <span class="effective-model">{{ state.effective.model }}</span>
            <span class="effective-provider">{{ effectiveProviderName }}</span>
          </div>
          <span class="source-badge" :class="state.source">{{ sourceLabel }}</span>
        </template>
        <div v-else class="effective-value muted">{{ t("admin.defaultModel.fallbackHint") }}</div>
      </div>
      <button class="btn-ghost danger" type="button" :disabled="clearing" @click="clearAll">
        {{ t("admin.defaultModel.clear") }}
      </button>
    </div>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>

    <template v-else>
      <!-- v2 模式组编辑器 -->
      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">{{ t("admin.defaultModel.v2Title") }}</h2>
            <p class="section-hint">{{ t("admin.defaultModel.v2Hint") }}</p>
          </div>
          <div class="section-actions">
            <button class="btn-ghost" type="button" @click="addGroup">{{ t("admin.defaultModel.addGroup") }}</button>
            <button class="btn-primary" type="button" :disabled="saving" @click="saveV2">
              {{ t("admin.defaultModel.saveGroups") }}
            </button>
          </div>
        </div>

        <!-- 模式 tab：设置各模式默认组 -->
        <div class="mode-row">
          <button
            v-for="mode in MODE_KEYS"
            :key="mode"
            class="mode-tab"
            :class="{ active: activeMode === mode }"
            type="button"
            @click="activeMode = mode"
          >
            {{ t(`admin.defaultModel.modes.${mode}`) }}
          </button>
        </div>

        <div v-if="draft" class="mode-default-row">
          <label class="field-inline">
            <span class="field-label">{{ t("admin.defaultModel.modeDefaultGroup") }}</span>
            <select
              :value="draft.modes[activeMode]?.defaultGroupId ?? ''"
              @change="draft.modes[activeMode] = { ...draft.modes[activeMode], defaultGroupId: ($event.target as HTMLSelectElement).value }"
            >
              <option value="">{{ t("admin.defaultModel.autoFirst") }}</option>
              <option v-for="g in groupsForMode(activeMode)" :key="g.id" :value="g.id">
                {{ g.name }}（{{ g.slug }}）
              </option>
            </select>
          </label>
        </div>

        <!-- 组列表（全部组都显示；modeKeys 徽标标出归属） -->
        <div v-if="draft && draft.groups.length" class="group-list">
          <div v-for="g in draft.groups" :key="g.id" class="group-card" :class="{ inactive: !g.enabled }">
            <div class="group-head">
              <button class="group-name-btn" type="button" @click="selectedGroupId = selectedGroupId === g.id ? '' : g.id">
                <span class="group-name">{{ g.name }}</span>
                <span class="group-slug">{{ g.slug }}</span>
              </button>
              <div class="group-badges">
                <span v-for="mk in g.modeKeys" :key="mk" class="mode-chip" :class="{ on: mk === activeMode }">
                  {{ t(`admin.defaultModel.modes.${mk}`) }}
                </span>
                <span v-if="!g.enabled" class="badge off">{{ t("common.disabled") }}</span>
              </div>
              <div class="group-actions">
                <button class="icon-btn" type="button" :title="t('common.moveUp')" @click="moveGroup(g.id, -1)">↑</button>
                <button class="icon-btn" type="button" :title="t('common.moveDown')" @click="moveGroup(g.id, 1)">↓</button>
                <button class="icon-btn danger" type="button" :title="t('common.delete')" @click="removeGroup(g.id)">✕</button>
              </div>
            </div>

            <!-- 展开的编辑区 -->
            <div v-if="selectedGroupId === g.id" class="group-body">
              <div class="grid-2">
                <label class="field">
                  <span class="field-label">{{ t("admin.defaultModel.groupName") }}</span>
                  <input v-model="g.name" type="text" />
                </label>
                <label class="field">
                  <span class="field-label">{{ t("admin.defaultModel.groupSlug") }}</span>
                  <input v-model="g.slug" type="text" />
                </label>
              </div>
              <div class="field-row">
                <label class="switch-row">
                  <input v-model="g.enabled" type="checkbox" class="switch" />
                  <span>{{ t("admin.defaultModel.groupEnabled") }}</span>
                </label>
                <div class="mode-toggle-row">
                  <button
                    v-for="mode in MODE_KEYS"
                    :key="mode"
                    class="mode-chip clickable"
                    :class="{ on: g.modeKeys.includes(mode) }"
                    type="button"
                    @click="toggleModeKey(g, mode)"
                  >
                    {{ t(`admin.defaultModel.modes.${mode}`) }}
                  </button>
                </div>
              </div>

              <!-- Profile 列表 -->
              <div class="profile-head">
                <span class="field-label">{{ t("admin.defaultModel.profiles") }}</span>
                <button class="btn-ghost small" type="button" @click="addProfileToGroup(g.id)">
                  {{ t("admin.defaultModel.addProfile") }}
                </button>
              </div>
              <div v-for="pid in g.profileIds" :key="pid" class="profile-row">
                <template v-if="profileById(pid)">
                  <select
                    class="profile-model"
                    :value="optionFor(profileById(pid)!.providerId, profileById(pid)!.model)"
                    @change="setProfileModel(profileById(pid)!, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="opt in modelOptions" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
                  </select>
                  <input
                    v-model="profileById(pid)!.displayName"
                    type="text"
                    class="profile-name"
                    :placeholder="t('admin.defaultModel.profileDisplayName')"
                  />
                  <label class="default-pick" :title="t('admin.defaultModel.defaultProfileHint')">
                    <input
                      type="radio"
                      :name="`default-${g.id}`"
                      :checked="g.defaultProfileId === pid"
                      @change="g.defaultProfileId = pid"
                    />
                    {{ t("admin.defaultModel.defaultProfile") }}
                  </label>
                  <label class="switch-row small">
                    <input v-model="profileById(pid)!.enabled" type="checkbox" class="switch" />
                    {{ t("common.enabled") }}
                  </label>
                  <button class="icon-btn danger" type="button" @click="removeProfile(g.id, pid)">✕</button>
                </template>
              </div>
              <div v-if="!g.profileIds.length" class="empty-hint small">
                {{ t("admin.defaultModel.noProfiles") }}
              </div>
            </div>
          </div>
        </div>
        <p v-else class="empty-hint">{{ t("admin.defaultModel.noGroups") }}</p>
      </section>

      <!-- v1 简单模式 -->
      <section class="section">
        <div class="section-head">
          <div>
            <h2 class="section-title">{{ t("admin.defaultModel.v1Title") }}</h2>
            <p class="section-hint">{{ t("admin.defaultModel.v1Hint") }}</p>
          </div>
        </div>
        <div class="field-row">
          <select v-model="v1Selection" class="v1-select">
            <option value="">{{ t("admin.defaultModel.pickModel") }}</option>
            <option v-for="opt in modelOptions" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
          </select>
          <button class="btn-primary" type="button" :disabled="saving || !v1Selection" @click="saveV1">
            {{ t("admin.defaultModel.saveV1") }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dm-view { display: flex; flex-direction: column; gap: 20px; }

/* 当前生效卡 */
.effective-card {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 18px;
  background: var(--grad-brand-soft);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
}
.effective-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.effective-value { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.effective-model { font-size: 18px; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono); }
.effective-provider { font-size: 13px; color: var(--text-secondary); }
.effective-value.muted { font-size: 13px; color: var(--text-tertiary); }

.source-badge {
  font-size: 11px; padding: 2px 10px; border-radius: 999px; font-weight: 600;
  background: var(--bg-card); color: var(--indigo-600); border: 1px solid var(--border);
}
.source-badge.fallback { color: var(--amber-600); }

.section {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); padding: 18px; box-shadow: var(--shadow-xs);
  display: flex; flex-direction: column; gap: 14px;
}
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.section-title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px; }
.section-hint { font-size: 12px; color: var(--text-tertiary); max-width: 560px; }
.section-actions { display: flex; gap: 8px; }

/* 模式 tab */
.mode-row { display: flex; gap: 4px; padding: 3px; background: var(--bg-subtle); border-radius: var(--r-md); width: fit-content; }
.mode-tab {
  padding: 6px 14px; border: none; border-radius: var(--r-sm); background: transparent;
  font-size: 12.5px; font-weight: 500; color: var(--text-secondary); cursor: pointer;
  transition: all 0.2s var(--ease);
}
.mode-tab:hover { color: var(--text-primary); }
.mode-tab.active { background: var(--bg-card); color: var(--indigo-600); font-weight: 600; box-shadow: var(--shadow-xs); }

.mode-default-row .field-inline { display: flex; align-items: center; gap: 10px; }

/* 组卡片 */
.group-list { display: flex; flex-direction: column; gap: 10px; }
.group-card {
  border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden;
  transition: all 0.2s var(--ease);
}
.group-card:hover { border-color: var(--border-strong); }
.group-card.inactive { opacity: 0.65; }

.group-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
.group-name-btn {
  display: flex; align-items: baseline; gap: 8px; background: none; border: none;
  cursor: pointer; padding: 2px 4px; border-radius: var(--r-sm);
}
.group-name-btn:hover { background: var(--bg-hover); }
.group-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
.group-slug { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }

.group-badges { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
.mode-chip {
  font-size: 10.5px; padding: 2px 8px; border-radius: 999px;
  background: var(--bg-hover); color: var(--text-tertiary);
}
.mode-chip.on { background: var(--grad-brand-soft); color: var(--indigo-600); font-weight: 600; }
.mode-chip.clickable { cursor: pointer; border: none; transition: all 0.15s var(--ease); }
.mode-chip.clickable:hover { color: var(--text-primary); }

.badge.off {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: var(--slate-100); color: var(--text-tertiary);
}

.group-actions { display: flex; gap: 2px; }
.icon-btn {
  width: 26px; height: 26px; border: none; border-radius: var(--r-sm); background: transparent;
  color: var(--text-tertiary); cursor: pointer; font-size: 13px; transition: all 0.15s var(--ease);
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.icon-btn.danger:hover { background: rgba(244, 63, 94, 0.1); color: var(--rose-500); }

.group-body { padding: 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; background: var(--bg-subtle); }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.field label, .field-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.field input, .field-inline select, .v1-select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 13px;
  transition: border-color 0.2s var(--ease);
}
.field-inline select, .v1-select { width: auto; min-width: 260px; }
.field input:focus, .field-inline select:focus, .v1-select:focus { outline: none; border-color: var(--teal-500); }

.switch-row { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.switch-row.small { font-size: 12px; }
.switch { accent-color: var(--teal-500); }

.mode-toggle-row { display: flex; gap: 4px; }

/* Profile 行 */
.profile-head { display: flex; align-items: center; justify-content: space-between; }
.profile-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); flex-wrap: wrap;
}
.profile-model { flex: 1; min-width: 220px; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); font-size: 12.5px; color: var(--text-primary); }
.profile-name { width: 140px; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); font-size: 12.5px; color: var(--text-primary); }
.default-pick { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
.default-pick input { accent-color: var(--teal-500); }

.empty-hint { color: var(--text-tertiary); text-align: center; padding: 24px 0; font-size: 13px; }
.empty-hint.small { padding: 8px 0; font-size: 12px; }

/* 按钮体系对齐 Providers.vue */
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border: none; border-radius: var(--r-md);
  background: var(--grad-teal-indigo); background-size: 200% 200%;
  color: white; font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: var(--shadow-sm); transition: all 0.25s var(--ease); white-space: nowrap;
}
.btn-primary:hover:not(:disabled) { background-position: 100% 0; transform: translateY(-1px); box-shadow: var(--shadow-md); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-secondary); font-size: 12.5px; cursor: pointer;
  transition: all 0.2s var(--ease); white-space: nowrap;
}
.btn-ghost:hover { border-color: var(--border-strong); color: var(--text-primary); }
.btn-ghost.small { padding: 5px 10px; font-size: 12px; }
.btn-ghost.danger:hover { border-color: var(--rose-400); color: var(--rose-500); }
</style>
