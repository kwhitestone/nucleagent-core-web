<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import AgentManagement from "../../agents/definition/AgentManagement.vue";
import { agentDefinitions } from "../../api/agent";

const route = useRoute();
const version = ref(getPlatformRuntime().getSessionVersion());
const initialId = Number(route.query.edit) || undefined;
function sessionChanged() { version.value = getPlatformRuntime().getSessionVersion(); }
onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, sessionChanged));
onUnmounted(() => window.removeEventListener(SESSION_CHANGE_EVENT, sessionChanged));
</script>

<template>
  <AgentManagement :key="version" :api="agentDefinitions" :initial-id="initialId" />
</template>
