# MUYU-410 OWUI 对照表（首批，范围收窄）

- OWUI 基线：`open-webui` **c38885a1a737da4968f157092f304f3b5481d0bf**（0.13.0，来源链见 MUYU-365 `OWUI-COMPARISON.md` / MUYU-284 证据）。本地源码：任务目录 `owui-src/tar/open-webui-c38885a…/`（此前下载的 v0.13.0 tarball 解压，未重新 clone）。
- 下表 file:line 均为本轮亲读；路径前缀 `src/lib/components/`。"我方"列为本分支 `feat/gap-owui-chrome` 当前代码。
- 已分给其他单（406–409/365）不在本单实现：模型/思考选择器、点赞/分叉、profile、工具 I/O、生图视频、spinner。见 365 对照表。

| 项 | OWUI 源码事实 | 锚点 | 我方现状 | 本单处理 |
|---|---|---|---|---|
| Markdown 单换行 | 消息渲染 `marked.use({ breaks: true })`：段内单个 `\n` 渲染为 `<br>`；注释写明消息可能先于输入框渲染，故此处显式设定 | `chat/Messages/Markdown.svelte:22-23`；输入框同设 `common/RichTextInput.svelte:10` | `task-conversation/markdown.ts` 用 `breaks: false`，模型回复的单换行被折叠成空格（Vue 与 React 共用） | **已实现**（首批唯一项）：改为 `breaks: true`，段落/代码块不变，DOMPurify 策略不变 |
| 代码块复制/语言标签 | Markdown token 渲染代码块（CodeBlock） | `chat/Messages/Markdown.svelte` 经 `MarkdownTokens.svelte` | React 已有语言标签+复制按钮（`src/chat-react/ChatApp.tsx` `addCodeCopyButtons`） | 已有，不改 |
| 历史搜索 | 侧栏搜索入口打开 SearchModal，后端 `getChatListBySearchText` | `layout/Sidebar.svelte:59`、`:105`、`:1082` | `listConversations` 只有 `beforeId/limit/agentId`（`api/conversation.ts:27`），无搜索参数 | 未实现；需 Core 搜索接口，后续 |
| 置顶/重命名 | ChatMenu 置顶开关 `toggleChatPinnedStatusById`、`renameHandler` | `layout/Sidebar/ChatMenu.svelte:14-15`、`:39`、`:50` | 会话前端未见 pin/rename | 未实现；需 Core 持久化合同，后续 |
| 移动端侧栏 | `$mobile` 分支 + `MobileSwipePanel`，`closeMobileSidebar` | `layout/Sidebar.svelte:18`、`:117`、`:349`、`:723` | 有 `useNarrow.ts`，未逐项比对手势 | 未实现；后续单独对照 |

偏离理由：皮肤沿用目鱼设计系统；只取行为（换行语义），不引入 marked/KaTeX/脚注等扩展（体积门禁）。
