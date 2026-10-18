<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { isBusinessBoundaryChange, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import AgentManagement from "../../agents/definition/AgentManagement.vue";
import { agentDefinitions } from "../../api/agent";

const route = useRoute();
const businessBoundaryGeneration = ref(0);
const initialId = Number(route.query.edit) || undefined;
function sessionChanged(event: Event) {
  if (isBusinessBoundaryChange(event)) businessBoundaryGeneration.value++;
}
onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, sessionChanged));
onUnmounted(() => window.removeEventListener(SESSION_CHANGE_EVENT, sessionChanged));
</script>

<template>
  <AgentManagement :key="businessBoundaryGeneration" :api="agentDefinitions" :initial-id="initialId" />
</template>
