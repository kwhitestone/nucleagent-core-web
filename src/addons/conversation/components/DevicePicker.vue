<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { confirmPrivateDevice, listPrivateDevices, type PrivateDevice } from "../api/conversation";
const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const devices = ref<PrivateDevice[]>([]);
const challenge = ref("");
const code = ref("");
const error = ref("");
const message = ref("");
const busy = ref(false);
let revision = 0;
async function reload(): Promise<void> {
  const current = ++revision;
  try {
    const result = await listPrivateDevices();
    if (current === revision) devices.value = result.filter((d) => !d.revokedAt && Date.parse(d.expiresAt) > Date.now());
  } catch { if (current === revision) error.value = "设备列表暂不可用，请刷新。"; }
}
async function confirm(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    await confirmPrivateDevice(challenge.value.trim(), code.value.trim().toUpperCase());
    message.value = "已确认。等待本机面板显示绑定成功，再刷新设备列表。";
    challenge.value = "";
    code.value = "";
  } catch { error.value = "绑定确认失败，请核对本机面板中的编号和验证码。"; }
  finally { busy.value = false; }
}
function onSessionChange(event: Event): void {
  revision++;
  devices.value = [];
  if ((event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated) void reload();
}
onMounted(() => { window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange); void reload(); });
onBeforeUnmount(() => { revision++; window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange); });
</script>
<template>
  <div class="device-picker">
    <label>执行设备
      <select :value="props.modelValue" :disabled="disabled || busy" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option value="">服务器</option>
        <option v-if="modelValue && !devices.some(d => d.id === modelValue)" :value="modelValue" disabled>指定 PC 不可用：{{ modelValue }}</option>
        <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }} · {{ device.os }}</option>
      </select>
    </label>
    <button type="button" :disabled="disabled || busy" @click="reload">刷新设备</button>
    <p v-if="modelValue">PC 需在本机开启接单，并在下方选择模型。当前 PC 不支持输入附件。</p>
    <details><summary>绑定本机面板中的设备</summary>
      <label>绑定编号<input v-model="challenge" maxlength="36" autocomplete="off" :disabled="busy || disabled"></label>
      <label>验证码<input v-model="code" maxlength="8" autocomplete="off" :disabled="busy || disabled"></label>
      <button type="button" :disabled="busy || disabled || !challenge || !code" @click="confirm">确认绑定到我的账户</button>
    </details>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.device-picker { display: grid; gap: 8px; }
label { display: grid; gap: 6px; }
select, input, button { min-height: 40px; padding: 8px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); font: inherit; }
p { font-size: 13px; color: var(--text-secondary); }
</style>
