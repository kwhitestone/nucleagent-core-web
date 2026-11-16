# MUYU-410 OWUI 对照表（首批，范围收窄）

- OWUI 基线：`open-webui` **c38885a1a737da4968f157092f304f3b5481d0bf**（0.13.0，来源链见 MUYU-365 `OWUI-COMPARISON.md` / MUYU-284 证据）。本地源码：任务目录 `owui-src/tar/open-webui-c38885a…/`（此前下载的 v0.13.0 tarball 解压，未重新 clone）。
- 下表 file:line 均为亲读（首批 + 第二轮 2026-11-16）；路径前缀 `src/lib/components/`。"我方"列为本分支 `feat/gap-owui-chrome` 当前代码。
- 已分给其他单（406–409/365）不在本单实现：模型/思考选择器、点赞/分叉、profile、工具 I/O、生图视频、spinner。见 365 对照表。

| 项 | OWUI 源码事实 | 锚点 | 我方现状 | 本单处理 |
|---|---|---|---|---|
| Markdown 单换行 | 消息渲染 `marked.use({ breaks: true })`：段内单个 `\n` 渲染为 `<br>`；注释写明消息可能先于输入框渲染，故此处显式设定 | `chat/Messages/Markdown.svelte:22-23`；输入框同设 `common/RichTextInput.svelte:10` | `task-conversation/markdown.ts` 用 `breaks: false`，模型回复的单换行被折叠成空格（Vue 与 React 共用） | **已实现**（首批唯一项）：改为 `breaks: true`，段落/代码块不变，DOMPurify 策略不变 |
| 代码块复制/语言标签 | Markdown token 渲染代码块（CodeBlock） | `chat/Messages/Markdown.svelte` 经 `MarkdownTokens.svelte` | React 已有语言标签+复制按钮（`src/chat-react/ChatApp.tsx` `addCodeCopyButtons`） | 已有，不改 |
| 历史搜索 | 侧栏搜索入口打开 SearchModal（`Sidebar.svelte:1082`）；输入 180ms 防抖、每次输入中止旧请求并以 generation 丢弃过期响应、清空即恢复（`SearchModal.svelte:106-118`）；分页按 page 追加并按 id 去重，失败显示「Try again」重试（`:120-149`、`:649-658`）；标签「Results / Pinned & recent」、加载中「Searching…」、空「No matches found」（`:584-587`、`:663`）；搜索范围含正文片段 snippet（`:634`） | `layout/SearchModal.svelte:99-149`、`:570-680`；`layout/Sidebar.svelte:96`、`:1082` | 原：`listConversations` 只有 `beforeId/limit/agentId`，无搜索 | **已实现（第五轮，仅标题）**：Core 列表 `GET ?q=`（trim、大小写不敏感子串、LIKE 通配符 `%`/`_`/`!` 转义、owner 隔离、已删隐藏、沿用 `beforeId` 游标分页、>80 字 400）；core-web 窄屏任务台顶部搜索框（`composables/historySearch.ts` + `Home.vue`）：180ms 防抖、最新请求生效、空白恢复原列表且不发请求、Esc 清空、「加载更多」按最后 id 翻页去重、失败「搜索失败。重试」。结果视图单独按 id 新到旧，原任务台 `deskOrder`（待处理优先）不变。偏离：不是弹窗而是任务台内联；不搜正文/无 snippet/无高亮/无过滤器/无键盘上下选择/无动效。**第六轮宽屏**：主壳 `AppSidebar` 历史区顶部内联搜索框（OWUI 为侧栏入口+弹窗），标签「最近→搜索结果」、「搜索中…」、空「没有标题匹配的对话」、失败「搜索失败。重试」、「加载更多」按钮（滚动到底同样翻页）；请求仍由 core-web 发起（壳→core `search`，core→壳 `search-results`，同会话版本校验），壳只存独立结果视图，正常历史与排序不变；Esc/清空回历史。偏离同上，另：无弹窗/无快捷键 |
| 置顶/重命名 | ChatMenu 置顶开关 `toggleChatPinnedStatusById`、`renameHandler`；ChatItem 进入编辑时填入原标题并全选（`ChatItem.svelte:474-488`），Enter 保存/Esc 取消、IME 组合中忽略（`:452-471`），失焦保存（`:418-424`），保存前 trim（`:252`）；位置在侧栏历史项 | `layout/Sidebar/ChatMenu.svelte:14-15`、`:39`、`:50` | 原：无 pin/rename；Core PATCH 只允许改 provider/model | **重命名已实现**（第三轮）：Core `PATCH {title}`（trim，1–80 字，owner，执行中也可改）＋ core-web 会话头内联编辑（`components/ConversationTitle.vue`），入口为 ⋯ 菜单/窄屏面板「重命名」和双击标题；失败回滚并 toast；改 store 行，经 `useShellBridge` 推到主壳侧栏。偏离：入口在会话头，不在侧栏行（侧栏归主壳，主壳未改）；无动效。**置顶未做**（需要 Core 字段和迁移）|
| 历史项标题方向 | 历史项标题容器 `dir="auto"`：阿拉伯语/希伯来语等 RTL 或中英混排标题按首个强方向字符排版，截断省略号落在正确一侧 | `layout/Sidebar/ChatItem.svelte:587-596` | 窄屏任务台“最近任务”行 `views/Home.vue` `.desk-row-title` 无 `dir`，RTL 标题随页面 LTR 排版 | **已实现**（第二项）：加 `dir="auto"`，样式/顺序/状态点不变 |
| 移动端侧栏开合 | `$mobile` 时选中历史项/新建对话调用 `closeMobileSidebar`；遮罩 `on:mousedown` 关闭；`MobileSwipePanel` 手势 | `layout/Sidebar.svelte:723-727`、`:965`、`:978`、`:1070-1078`、`:1058-1061` | core-web 在 iframe 内不渲染历史侧栏；侧栏由主壳渲染，core-web 只经 `useShellBridge.ts` 推送列表（`pushConversations`）。窄屏下 core-web 用 `Home.vue` 任务台代替侧栏 | 不在本仓；属主壳仓，未审计 |
| 历史按时间分组 | `chat.time_range` 变化处插入分组标题（Today/Yesterday/Previous 7 days/30 days/月份/年份） | `layout/Sidebar.svelte:1824-1831`；`utils/index.ts:1302-1331` `getTimeRange` | 任务台按 板§11 `deskOrder` 排序：待处理→执行中→其余按时间（`composables/taskDesk.ts:9`），与时间分组冲突 | 未实现；需产品定夺排序规则 |
| 历史项双击重命名 | `ondblclick={renameChatFromDoubleClick}` | `layout/Sidebar/ChatItem.svelte:766` | 双击会话头标题即进入编辑（主壳侧栏行的双击归主壳，未做） | 部分实现（会话头） |
| 浏览器标签页标题 | 会话标题截 30 字 + `/ WEBUI_NAME` | `chat/Chat.svelte:5111-5117` | core-web 在 iframe 内，标签页标题归主壳 | 不在本仓；未审计 |

偏离理由：皮肤沿用目鱼设计系统；只取行为（换行语义），不引入 marked/KaTeX/脚注等扩展（体积门禁）。
