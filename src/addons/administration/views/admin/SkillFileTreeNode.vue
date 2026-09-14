<script setup lang="ts">
/**
 * SkillFileTreeNode —— 技能包文件树的递归节点。
 *
 * 独立 SFC（而非同文件 defineComponent）：递归组件用自身文件名即可自引用
 *（Vue SFC 编译器支持），比 defineComponent + h() 手写 render 简单可靠。
 */
import type { SkillFileNode } from "../../api/admin";

defineProps<{
  node: SkillFileNode;
  depth: number;
  selected: string;
  expanded: Set<string>;
}>();

defineEmits<{
  select: [path: string];
  toggle: [path: string];
}>();
</script>

<template>
  <div class="tree-branch">
    <button
      v-if="node.isDir"
      class="tree-item dir"
      type="button"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      @click="$emit('toggle', node.path)"
    >
      <span class="tree-caret">{{ expanded.has(node.path) ? "▾" : "▸" }}</span>
      <span>{{ node.name }}</span>
    </button>
    <button
      v-else
      class="tree-item file"
      :class="{ active: selected === node.path }"
      type="button"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      :title="node.path"
      @click="$emit('select', node.path)"
    >
      <span class="tree-caret placeholder">·</span>
      <span class="tree-item-name">{{ node.name }}</span>
    </button>
    <template v-if="node.isDir && expanded.has(node.path)">
      <SkillFileTreeNode
        v-for="child in node.children ?? []"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :selected="selected"
        :expanded="expanded"
        @select="$emit('select', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-item {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 8px; border: none; background: none; border-radius: var(--r-sm);
  font-size: 12.5px; color: var(--text-secondary); cursor: pointer; text-align: left;
  transition: all 0.15s var(--ease); white-space: nowrap; overflow: hidden;
}
.tree-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.tree-item.file.active { background: var(--grad-brand-soft); color: var(--indigo-600); font-weight: 600; }
.tree-item.dir { color: var(--text-primary); font-weight: 500; }
.tree-caret { width: 12px; flex-shrink: 0; font-size: 10px; color: var(--text-tertiary); }
.tree-caret.placeholder { opacity: 0.4; }
.tree-item-name { overflow: hidden; text-overflow: ellipsis; }
</style>
