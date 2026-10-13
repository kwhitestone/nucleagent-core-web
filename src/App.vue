<script setup lang="ts">
import { RouterView } from "vue-router";
import ConversationDeleteHost from "@/addons/conversation/components/ConversationDeleteHost.vue";
</script>

<template>
  <router-view />
  <ConversationDeleteHost />
</template>
