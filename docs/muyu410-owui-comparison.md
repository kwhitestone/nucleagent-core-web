# MUYU-410 OWUI 对照表（首批，范围收窄）

- OWUI 基线：`open-webui` **c38885a1a737da4968f157092f304f3b5481d0bf**（0.13.0，来源链见 MUYU-365 `OWUI-COMPARISON.md` / MUYU-284 证据）。本地源码：任务目录 `owui-src/tar/open-webui-c38885a…/`（此前下载的 v0.13.0 tarball 解压，未重新 clone）。
- 下表 file:line 均为亲读（首批 + 第二轮 2026-11-16）；路径前缀 `src/lib/components/`。"我方"列为本分支 `feat/gap-owui-chrome` 当前代码。
- 已分给其他单（406–409/365）不在本单实现：模型/思考选择器、点赞/分叉、profile、工具 I/O、生图视频、spinner。见 365 对照表。

| 项 | OWUI 源码事实 | 锚点 | 我方现状 | 本单处理 |
|---|---|---|---|---|
| Markdown 单换行 | 消息渲染 `marked.use({ breaks: true })`：段内单个 `\n` 渲染为 `<br>`；注释写明消息可能先于输入框渲染，故此处显式设定 | `chat/Messages/Markdown.svelte:22-23`；输入框同设 `common/RichTextInput.svelte:10` | `task-conversation/markdown.ts` 用 `breaks: false`，模型回复的单换行被折叠成空格（Vue 与 React 共用） | **已实现**（首批唯一项）：改为 `breaks: true`，段落/代码块不变，DOMPurify 策略不变 |
| 代码块复制/语言标签 | Markdown token 渲染代码块（CodeBlock） | `chat/Messages/Markdown.svelte` 经 `MarkdownTokens.svelte` | React 已有语言标签+复制按钮（`src/chat-react/ChatApp.tsx` `addCodeCopyButtons`） | 已有，不改 |
| 历史搜索 | 侧栏搜索入口打开 SearchModal，后端 `getChatListBySearchText` | `layout/Sidebar.svelte:59`、`:105`、`:1082` | `listConversations` 只有 `beforeId/limit/agentId`（`api/conversation.ts:27`），无搜索参数 | 未实现；需 Core 搜索接口，后续 |
| 置顶/重命名 | ChatMenu 置顶开关 `toggleChatPinnedStatusById`、`renameHandler` | `layout/Sidebar/ChatMenu.svelte:14-15`、`:39`、`:50` | 会话前端未见 pin/rename | 未实现；需 Core 持久化合同，后续 |
| 历史项标题方向 | 历史项标题容器 `dir="auto"`：阿拉伯语/希伯来语等 RTL 或中英混排标题按首个强方向字符排版，截断省略号落在正确一侧 | `layout/Sidebar/ChatItem.svelte:587-596` | 窄屏任务台“最近任务”行 `views/Home.vue` `.desk-row-title` 无 `dir`，RTL 标题随页面 LTR 排版 | **已实现**（第二项）：加 `dir="auto"`，样式/顺序/状态点不变 |
| 移动端侧栏开合 | `$mobile` 时选中历史项/新建对话调用 `closeMobileSidebar`；遮罩 `on:mousedown` 关闭；`MobileSwipePanel` 手势 | `layout/Sidebar.svelte:723-727`、`:965`、`:978`、`:1070-1078`、`:1058-1061` | core-web 在 iframe 内不渲染历史侧栏；侧栏由主壳渲染，core-web 只经 `useShellBridge.ts` 推送列表（`pushConversations`）。窄屏下 core-web 用 `Home.vue` 任务台代替侧栏 | 不在本仓；属主壳仓，未审计 |
| 历史按时间分组 | `chat.time_range` 变化处插入分组标题（Today/Yesterday/Previous 7 days/30 days/月份/年份） | `layout/Sidebar.svelte:1824-1831`；`utils/index.ts:1302-1331` `getTimeRange` | 任务台按 板§11 `deskOrder` 排序：待处理→执行中→其余按时间（`composables/taskDesk.ts:9`），与时间分组冲突 | 未实现；需产品定夺排序规则 |
| 历史项双击重命名 | `ondblclick={renameChatFromDoubleClick}` | `layout/Sidebar/ChatItem.svelte:766` | Core `PATCH /conversation/:id` 只允许改 provider/model（Core `conversation/router/router.go:564` 注释：title 由系统维护） | 未实现；需 Core 合同 |
| 浏览器标签页标题 | 会话标题截 30 字 + `/ WEBUI_NAME` | `chat/Chat.svelte:5111-5117` | core-web 在 iframe 内，标签页标题归主壳 | 不在本仓；未审计 |

偏离理由：皮肤沿用目鱼设计系统；只取行为（换行语义），不引入 marked/KaTeX/脚注等扩展（体积门禁）。
