# MUYU-365 core-web 聊天底座重写方案（React + assistant-ui）

> 第 1 棒：只读调研 + 方案，不改业务代码、不装依赖、不碰 TEST 环境。读取日期 2026-11-13。
> 基线：nucleagent-core-web `c0a82a7`（本地 origin/main；github 当天连不上，未 fetch）。
> 证据写法：无前缀 = 本仓路径；`shell:` = nucleagent-web；`pf:` = prism-fusion；`skill:` = `wt-muyu-ui-skill/.agents/skills/muyu-ui-guideline-v2/`；`325:` = nucleagent-docs 分支 `docs/muyu325-owui-chat-design` 的 `docs/nucleagent/14-owui-chat-core-web-dual-channel-design.md`；`aui:` = npm 包 `@assistant-ui/react@0.15.36` / `@assistant-ui/core@0.3.35` 解包后的源码（`npm pack` 到 $TMPDIR）。
> 标“未核实”的就是没核实到，没有凭印象补。

## 0. 结论摘要

- **宿主形态：方案 ② 进程内变体。** 保留 Vue 壳（core-web 的 router、插件宿主、platform-api、useShellBridge、管理后台全部不动），聊天路由组件换成一层很薄的 Vue 包装：懒加载 React + assistant-ui 分包，`createRoot(div)` 挂上去，并用开关决定走旧 Vue 视图还是 React 视图。外壳 nucleagent-web、Agentia 和其它颗粒**零改动**。
- **assistant-ui：** `@assistant-ui/react` **0.15.36**（2026-11-12 发布），**MIT 属实**（LICENSE 原文，版权 AgentbaseAI Inc.），没有品牌或署名强制条款，只需保留 MIT 版权声明。要求 React `^18 || ^19`。运行时用 **ExternalStoreRuntime**（历史和任务状态归 Core），不用 LocalRuntime/ChatModelAdapter。
- **迁移矩阵**（38 个功能点，跨类的两边都计）：**重写保留 19 / assistant-ui 提供 9 / 需自写适配 15**。
- **可复用：** 聊天模块 `.ts` 共 7,629 行，其中 **5,967 行是纯 TS（不 import vue）**，React 端可以原样 import：api 层、SSE 解码器、v2 协议 reducer/schema、消息适配器、续传与计时策略、过程呈现。要重写的是 8,110 行 `.vue`、1,275 行 CSS，以及 1,662 行与 Vue 耦合的 `.ts`。
- **历史数据不需要迁移：** 消息只存在 Core，前端没有本地持久化的消息（§5）。
- **MVP 约 2 周（单人），全量约 7–9 周（单人）/ 约 5 周（两人）**，详见 §8。

---

## 1. 宿主形态决策记录

### 1.1 耦合点（以代码为准）

| 耦合点 | 现状 | 证据 |
|---|---|---|
| 启动 | `index.html` 的 `#core-app` 挂载点 → `boot.ts` 先拉 `/runtime-config.json` → `main.ts`。`createApp` → pinia → i18n → `createPluginHost({router, coreRoutes, homePath:"/chat"})` → 注册 `[platformApi, modelCatalog, administration, conversation]` | `index.html:9-10`；`src/boot.ts:7-12`；`src/main.ts:31-45` |
| 握手缓冲 | 在模块求值阶段就缓冲 `host:init` / `agentia:embed-init` | `src/bootstrap.ts:7-36`；`src/main.ts:24` |
| 路由 | 嵌入时用 hash history。聊天路由全部由 addon 声明：`/chat`、`/tasks`、`/b/:groupId`、`/agents`、`/generate/:kind`、`/deleted`、`/c/:id`，每条都是 `authenticatedRoute(() => import(...vue))` | `src/router/index.ts:8-22`；`src/addons/conversation/index.ts:21-80` |
| 插件运行时 | vendored 自 prism-fusion，进程内 addon 用 vue-router 的 `RouteRecordRaw`；“远程应用”是 iframe + `prism-fusion/remote` v1 postMessage 信封 | `src/vendor/prism-fusion-plugin-runtime/VENDORED.md:3-17`；`pf:docs/plugin-spec-v2.md:16,253-261`；`pf:…/remote-channel.ts:4-30,55-76,118-141` |
| 壳通道 | `createRemoteChildChannel(appId core)`。壳→子：`auth / view / locale / load-more / delete`；子→壳：`auth-required / conversations / view-changed`。侧栏列表来自 **Pinia `useConversationStore`** 加当前 vue-router 路由 | `src/addons/conversation/composables/useShellBridge.ts:15-16,47,80-92,112-136,146-227` |
| 外壳侧 | 壳把 core 当 `core` 远程应用用 iframe 嵌入，路由映射 `/chat/:id → /c/:id`；子应用 ready 后依次发 auth → locale → view；**不发 theme** | `shell:src/addons/core-remote/remote.ts:4-27`；`shell:…/RemoteFrame.vue:31-46`；`shell:…/CoreRemoteHost.vue:45-92` |
| 令牌 | 壳推送 `{token, sessionVersion, principal, permissions…}` → `applyShellSession`。iframe 内**只放内存**（并主动清掉 localStorage），refresh token 从不进 iframe 源 | `src/addons/platform-api/session/embeddedSession.ts:75-146`；`src/utils/token.ts:11-27`；`shell:…/remoteSession.ts:22-57` |
| 平台运行时 | `getPlatformRuntime()` 单例提供 `http / apiBase / authHeaders / getAccessToken / handleUnauthorizedResponse / isInShell`；会话变化走 window 事件 `nucleagent:session-change`。对 Vue **只有一处 type import**（`Component`） | `src/contracts/platform-runtime.ts:1-2,24-62,94-97`；`src/addons/platform-api/api/http.ts:23-120` |
| i18n | vue-i18n，`src/i18n/{zh,en}.ts`；locale 由壳的 `locale` 消息驱动 `setLocale` | `src/i18n/index.ts:7-33`；`useShellBridge.ts:131-136` |
| 主题 | `src/styles/aurora.css`：`:root` 全局 CSS 变量（`--moyu-*` 品牌色，以及 `--fg-* / --bg-* / --r-*` 语义别名），由 `nucleagent-deploy/scripts/sync-design-tokens.sh` 同步到 7 个前端，**不要手改**。没有全局暗色，只零散用了 `prefers-color-scheme` | `src/styles/aurora.css:1-46,131-138`；`task-conversation/styles.css:918,1066` |
| Element Plus | 还在 package.json 里，但**已被刻意弃用**（源码只有 2 处注释提到它） | `components/ModelPicker.vue:6`；`components/AttachmentPicker.vue:7` |
| editor-ui | `@prism-fusion/editor-ui` 只支持 Vue（peer vue ^3.5），管理后台和 `UserAgentWizard.vue:7` 在用 | `src/main.ts:1` |
| 账户卡 | `/remote/account-ui.js` 是壳构建出来的纯 DOM ESM（不依赖框架）。im-web 已在消费；**core-web 的 src 目前没用**，只有 `tests/outerHost.test.ts:10` 提到 | `shell:vite.remote.config.ts:5-37`；`shell:src/account-ui/contract.ts:1-75` |
| 运行时配置 | `runtime-config.json` 由固定键表生成，并且**拒绝未知键**；要新增运行时开关键，两处都得改 | `docker-entrypoint.d/40-runtime-config.sh:45-78`；`src/…/runtimeConfig.ts:33-35` |
| nucleagent-shared | 只有 Go（模型、A2A），**没有任何前端共享包** | `nucleagent-shared/README.md:1-28` |

### 1.2 三个方案对比

| | ① 整个 core-web 改 React | ② 保留 Vue 壳，聊天区挂 React（**选此，进程内**） | ③ 聊天页做成独立的 React 入口/HTML |
|---|---|---|---|
| 改动面 | 约 31.7k 行全部重写，包括管理后台、editor-ui（只支持 Vue）、vendored 插件运行时（基于 vue-router） | 只改聊天路由组件（每条一个包装），其余不动 | 第二个 Vite 入口 + nginx 路由；壳要么加新远程应用条目，要么把 shell-bridge 复制一份 |
| 壳/其它颗粒 | 不变（iframe 边界），但 core 内部全是风险 | **不变**：`entryUrl`、路由映射、消息类型都不动（`shell:remote.ts:9-26`） | iframe 跳到另一个文档会重建通道（`shell:RemoteFrame.vue:31`），runtime-config、握手、auth 全部重跑；很可能要改壳 |
| 令牌 | 要重写会话层 | 复用 `getPlatformRuntime()`，令牌只在内存，不经过新的持久化代码 | 两套会话层 |
| 回滚 | 只能整包回滚 | 按路由开关切换，Vue 视图留在包里 | 改 nginx/壳 |
| 代价 | 最大、无法灰度；还违反设计规范的换栈边界 | 包里同时有 Vue 和 React（React 分包懒加载）；React 调 Pinia/vue-router 需要一层薄桥 | 多一个入口，壳通道逻辑重复 |

**理由：** ② 是唯一满足“壳和其它颗粒零影响 + 新旧并存 + 一键回滚”的方案。React 岛直接复用 `getPlatformRuntime()`（鉴权、apiBase、401 处理）和 `nucleagent:session-change` 事件；侧栏继续写同一个 Pinia store，`useShellBridge` 原样工作。③ 里面的“core 内部再套同源 iframe”变体，同样要复制一份通道并多一跳 postMessage，所以不选。

**React ↔ Vue 桥（只保留这几处）：**
1. `ChatHost.vue`：`onMounted` 时 `import("@/chat-react/mount")` → `mount(el, {conversationId, navigate, locale})`，`onBeforeUnmount` 时 `root.unmount()`；路由参数变化时更新 props。
2. 导航：React 调传进来的 `navigate(path)`（内部用 `router.push`），**不在 React 里引入 react-router**。
3. 侧栏：React 端的会话列表操作通过 `useConversationStore()`（pinia 实例在 `main.ts:32` 已激活）回写，保持 `useShellBridge` 推给壳的数据一致。
4. 语言：React 订阅 vue-i18n 的 locale（`i18n.global.locale`），文案直接用 `i18n.global.t`，复用同一套 zh/en 文案，**不再引入第二套 i18n 库**。（matrix 子调研建议用 react-i18next；这里采用更省事的做法，MVP 阶段验证。）
5. 工程：Vite 加 `@vitejs/plugin-react`，只作用于 `src/chat-react/**/*.tsx`；`@vitejs/plugin-vue` 保持不变。tsconfig 按目录分 `jsx: react-jsx`。

> 注意：设计规范 `skill:SKILL.md:54` 原文写着“**规范不授权把 Vue 仓迁到 React 或 Tailwind；换栈要另立需求，经用户批准**”。本任务的 brief 称用户已授权重写，但这个授权要在 MUYU-365 工单上留下书面记录（见拍板点 U1）。

### 1.3 样式统一方案

- **不引入 Tailwind/shadcn。** assistant-ui 的 `*Primitive`（Thread、Message、Composer、ActionBar、Attachment、ThreadList…）本身无样式（`aui:src/primitives/*`）。shadcn 主题只是 CLI 复制进项目的示例代码（README “start from a polished shadcn/ui theme that the CLI copies into your project”），不是运行时依赖。
- 用 `aurora.css` 的语义变量写一份 `chat-react/chat.css`，类名统一加 `mc-` 前缀，避免与全局的 `task-conversation/styles.css`、`editor-ui/style.css` 冲突。
- 如果后续要从 shadcn 示例里抄组件：把它的 `--background / --foreground / --primary / --radius…` 一次性映射到 `--bg-* / --fg-* / --moyu-primary(#3072FF) / --r-*`，并且**关闭 preflight**，避免覆盖 `aurora.css:185-191` 的 base 样式。
- 设计规范约束（`skill:references/brand-tokens.md`）：只用 Noto Sans SC；字号 12/14/16/20/28/36/48；字重 400/500/700（**禁用 600**）；圆角 0/8/12/14/16/20/24/999；间距按 4 的刻度；橙色 `#FB730D` 每屏最多一次；第一版只做亮色（`[data-theme]` 预留）；焦点环 2px `#3072FF`、offset 2。**面向用户的界面禁用 lucide 图标**（`:101`），要用内联 sprite（规范 §3.3 MuyuIcon）。现在聊天模块用了 5 处 lucide，借这次重写一并清掉。
- 规范里的 Vue/EP 路径（M2.5 EP 变量映射）对 React 不适用；React 部分直接用 tokens.css 的变量，和规范附录 A 的 React 示例同源（`skill:templates/tokens.css` 与 `aurora.css:24-46` 的值相同）。

---

## 2. assistant-ui 核查表（读取日期 2026-11-13）

github.com 与 www.assistant-ui.com 当天都连不上（curl `Connection reset by peer`，WebFetch 也被拒）。以下全部来自 npm registry 元数据和 `npm pack` 下来的包内源码/README/LICENSE。**文档站的内容一律没读到**。

| 项 | 结论 | 来源 |
|---|---|---|
| 当前版本 | `@assistant-ui/react` **0.15.36**，time.modified 2026-11-12T04:32Z；0.15.0 发布于 2026-07-28；包创建于 2024-05-07。依赖 `@assistant-ui/core@^0.3.35`、`assistant-stream@^0.3.57`、`@assistant-ui/store`、`@assistant-ui/tap`、`assistant-cloud`、`safe-content-frame`、`radix-ui@^1.8.1`、`zustand@^5`、`zod@^4.6.7`、`react-textarea-autosize` | `npm view @assistant-ui/react version time dependencies` |
| 许可证 | **MIT 属实**。LICENSE 是标准 MIT 全文，“Copyright (c) 2026 AgentbaseAI Inc.”。core / store / tap / assistant-stream / assistant-cloud / safe-content-frame / react-markdown 七个包的 LICENSE 都是同样的 MIT | 各包 `package/LICENSE` |
| 品牌/署名 | MIT 只要求保留版权和许可声明，**没有界面署名、Logo、“Powered by” 之类的条款**。README 末尾写“MIT, with optional Assistant Cloud”。源码里搜 powered by / attribution / watermark 都没有命中 | `aui:README.md` 末尾；grep |
| 传递依赖许可证 | react、react-dom、radix-ui、zustand、react-textarea-autosize、react-markdown、zod、nanoid、classnames 都是 MIT；**secure-json-parse 是 BSD-3-Clause**（只需保留声明）。完整依赖树的许可证扫描要等 MVP 装包后用 `license-checker` 跑，**本棒没跑完整树** | `npm view <pkg> license` |
| React 版本 | peer `react` / `react-dom` `^18 \|\| ^19`（当前 react 19.3.1） | `npm view … peerDependencies` |
| 可选 peer | assistant-stream 的 `ai` 和 `ioredis`、assistant-cloud 的 `ai` 和 `@opentelemetry/*` 都是 optional，不装也行 | 各包 `package.json` 的 `peerDependenciesMeta` |
| 外连/遥测 | 源码里没有遥测。`CloudRendererHost` 默认允许的源是 `https://cloud.assistant-ui.com`（`aui:src/cloud-renderer/CloudRendererHost.tsx:39`）；`safe-content-frame` 把内容放到第三方域 `scf.auiusercontent.com` 渲染（其 README）。**这两个只有显式使用 `SandboxHost` / cloud renderer 才会触发**，我们不用，并且要在 CSP 里不放行这两个域 | grep |
| 包体积 | `@assistant-ui/react` 解包后约 3.0 MB（`dist` 4.2 MB，含 sourcemap 等），`sideEffects:false`。**gzip 后的实际增量没测**，留给 MVP 用 `vite build` 加 visualizer 量 | `npm view dist.unpackedSize`；`du` |
| 运行时选型 | `useLocalRuntime(ChatModelAdapter)`：`run({messages, abortSignal, context})` 返回 Promise 或 AsyncGenerator，即“一次请求一条流、消息状态归前端”（`aui:core/src/runtime/utils/chat-model-adapter.ts:66-70`）。`useExternalStoreRuntime(ExternalStoreAdapter)`：由宿主持有 `messages`，通过 `convertMessage` 转换，提供 `isRunning / onNew / onCancel / onReload / onEdit / onDelete / setMessages / onLoadEarlier / adapters.attachments / adapters.threadList / queue`（`aui:core/src/runtimes/external-store/external-store-adapter.ts:84-265`）。**选 ExternalStore**：我们是长连接 SSE 推送“整行消息”，状态由 Core 和现有 reducer 持有，与 LocalRuntime 的模型不匹配 | 源码 |
| 流式 | ExternalStore 下只要宿主更新 `messages` 就会重渲染，不关心增量是怎么来的。`isRunning` 可以由宿主显式给出（`:107-114`）。平滑打字效果由 `@assistant-ui/react-markdown` 提供，**`smooth` 参数的名字没在源码里逐行核实** | 源码 |
| 取消 | `onCancel?: () => Promise<void>`（`:221`），对应 `ComposerPrimitive.Cancel` | 源码 |
| 重试/重新生成 | `onReload?(parentId, config)`（`:217-219`），不提供就不显示。**我们后端没有 retry 接口**（`composables/useConversationAdapter.ts:789-791`） | 源码 |
| 编辑/分支 | `onEdit` + `setMessages` 开启分支，`BranchPickerPrimitive` 已导出（`aui:src/index.ts:338`）。`onBranchChange` 标着 Experimental（2026-06-23）。后端不支持分支，**本期不做** | 源码 |
| 附件 | `AttachmentAdapter {accept, add, remove, send}`，`add` 可以是 AsyncGenerator 用来报上传进度（`aui:core/src/adapters/attachment.ts:9-20`）；自带 `SimpleImageAttachmentAdapter` / `CompositeAttachmentAdapter`（默认会转成 dataURL/内联文本，**我们不能用默认实现**，要包一层现有的 presign 上传） | 源码 |
| 工具卡片 | `makeAssistantToolUI` / `makeAssistantDataUI` / `useAssistantToolUI` 已导出（`aui:src/index.ts:217-223`）；消息 part 类型有 `text / reasoning / source / image / file / audio / data / tool-call`（`aui:core/src/types/message.ts:19-337`）；还有 `ChainOfThoughtPrimitive`（`:339`） | 源码 |
| 人在回路 | `onAddToolResult / onResumeToolCall / onRespondToToolApproval`（`:231-240`），可以承载“澄清问题”（clarify） | 源码 |
| 排队 | ExternalStore 有 `queue?: ExternalThreadQueueAdapter`（`createMessageQueue`），以及 `QueueItemPrimitive`（Text / Remove / Steer）。**可用来实现 325 §B.6 的“执行中排队发送”**；具体语义没读完，MVP 验证 | `:202-203`；`aui:src/primitives/queueItem/*` |
| 线程列表 | `adapters.threadList`（标注 Experimental，2024-10-18）或 `useRemoteThreadListRuntime`。我们的侧栏在壳里，core 内部只需要“最近删除”等页面，**不依赖这块** | 源码 |
| 加载更早消息 | `hasEarlier` + `onLoadEarlier`（`:125-143`）；现在后端 `GET /messages` 不分页，暂时用不上 | 源码 |
| API 稳定性 | 很多字段标着 `@deprecated Experimental since …`（Experimental 是作者的“不稳定”标记，不是要删除）。0.x 版本，小版本之间可能有破坏性变化 → **锁定精确版本** | 源码注释 |
| 文档站/GitHub 页 | **NOT_VERIFIED**（当天网络不可达） | — |

---

## 3. 功能迁移矩阵

分类：**保留重写** = 我们自己的业务界面，用 React 手写；**由 aui 提供** = 直接用 assistant-ui 原语；**自写适配** = 在后端/现有状态与 aui 运行时之间写一层胶水（纯 TS 模块大多可以直接复用）。路径都相对 `src/addons/conversation/`。

| # | 功能 | 证据 | 分类 |
|---|---|---|---|
| 1 | 任务会话 reducer/schema/协议 v2 | `task-conversation/core/types.ts:1`（`CONVERSATION_PROTOCOL_VERSION = 2`）、`core/schema.ts:193`、`core/reducer.ts:53-64,130-141,455`、`core/batcher.ts:29` | 自写适配（原样复用核心，`selectTurns` → `ThreadMessageLike[]`） |
| 2 | 控制器（快照 → 订阅 → 重试、乐观发送） | `task-conversation/vue/useConversation.ts:46`（只用到了 `shallowRef/computed/onBeforeUnmount`）、`:223-275`、`:510-520`、`:620` | 自写适配（约 600 行，移植为 `useSyncExternalStore` store） |
| 3 | 后端消息 → v2 事件适配器 | `composables/useConversationAdapter.ts:412-801`（纯 TS） | 自写适配（原样复用） |
| 4 | 阶段消息 | `task-conversation/vue/executionPhasePresentation.ts:8-32`、`vue/processPresentation.ts:76-90,286-364` | 保留重写（界面）；纯函数复用 |
| 5 | 排队位置 | `composables/conversationTiming.ts:31-35`、`executionPhasePresentation.ts:34-41` | 保留重写 |
| 6 | 409 / 执行中追问 | 乐观消息撤回 `useConversation.ts:516-518`；不存在专门针对排队的 409 处理；325 §B.6 要求改成“待发送”队列 | 保留重写（+ aui `queue` 可选） |
| 7 | 命令输出 | `useConversationAdapter.ts:246`（`terminal` → “命令执行”标题） | 由 aui 提供（tool-call fallback）+ 自定义标题 |
| 8 | 产物 | `task-conversation/vue/TaskConversation.vue:621-623,1000-1024`、`processPresentation.ts:39-54` | 保留重写 |
| 9 | 生图/生视频卡片 | `components/media/*`（约 930 行）、`views/Conversation.vue:100-140`（轮询）、`registry.ts:20-41`、`composables/generation.ts`、`chatGeneration.ts` | 保留重写 |
| 10 | 附件（选择、标签、上传、图片预览） | `components/AttachmentPicker.vue:16,69`、`AttachmentChips.vue:17`、`ImageAttachmentPreview.vue:13-39`、`api/storage.ts:119-166`、`api/imageContent.ts` | 自写适配（`AttachmentAdapter` 包装 `uploadFile`）+ 保留重写（带鉴权取图的预览/灯箱） |
| 11 | 取消 | `useConversationAdapter.ts:773-782`（404 视为成功）、`api/conversation.ts:140` | 由 aui 提供（`onCancel`） |
| 12 | 断线续传 | `api/conversation.ts:267-351`（`Last-Event-ID`、30s 看门狗）、`composables/conversationStreamPolicy.ts:19-62`、`vue/retryPolicy.ts:10-13` | 自写适配（原样复用） |
| 13 | 快照/导航缓存 | `composables/conversationNavigationCache.ts:19-24`、`conversationNavigation.ts:6-27` | 自写适配（原样复用） |
| 14 | 思考折叠 | `useConversationAdapter.ts:90-136,210-233,625-693`、`TaskConversation.vue:487-546` | 由 aui 提供（`reasoning` part）；“思考完成”判定留在适配器 |
| 15 | 工具卡片 | `task-conversation/toolDetails.ts:67-132`、`useConversationAdapter.ts:271-292` | 由 aui 提供（`makeAssistantToolUI`）+ 搜索/计划卡保留重写 |
| 16 | 过程分组（耗时、摘要） | `processPresentation.ts:400-520`、`TaskConversation.vue:244-306` | 保留重写（自定义 part / ChainOfThought） |
| 17 | 历史侧栏/会话列表 | `store/conversation.ts:24-97`、`api/conversation.ts:46-60`、侧栏本体在壳里 | 自写适配（继续写 Pinia store） |
| 18 | 删除/撤销/最近删除 | `composables/conversationDelete.ts:2-46`、`useConversationDelete.ts:15`、`views/RecentlyDeleted.vue:19-34` | 自写适配 + 保留重写（撤销条） |
| 19 | 壳通信 useShellBridge | `composables/useShellBridge.ts:44-232`、`shellMessagePolicy.ts:1-27` | 保留重写；**按 §1 宿主形态，MVP 阶段原样保留 Vue 版，不重写** |
| 20 | 统一用户卡/头像 | 本模块没有 account-ui；头像 API 在 `api/userAvatar.ts:10-99`，`components/AgentCard.vue:12,26` | 保留重写（后续可改用壳的 `/remote/account-ui.js`，im-web 已有先例） |
| 21 | 模型选择器 | `components/modelPickerOptions.ts:26-47`、`ModelPicker.vue:29,76,84`、`composables/conversationModelRestore.ts` | 保留重写（Composer 工具栏插槽） |
| 22 | 执行后端选择 | `components/ExecutionBackendPicker.vue:1-60`、`composables/executionBackendCompatibility.ts:20`、`api/types.ts:102`。**代码里还没有 fast/sandbox 概念** | 保留重写（并入 325 的统一分组下拉） |
| 23 | 技能/工具选择、会话绑定 | `components/SkillPicker.vue`、`ToolPicker.vue`、`BindingPickers.vue`、`api/sessionBindings.ts`、`api/skill.ts` | 保留重写 |
| 24 | 多后端对比（broadcast） | `views/BroadcastConversation.vue:47-157`、`composables/useBroadcastAdapter.ts:13`、`api/broadcast.ts:91-109` | 自写适配（每个成员一个 runtime） |
| 25 | 智能体（列表/实例/向导） | `views/AgentList.vue`、`AgentInstance.vue`、`components/UserAgentWizard.vue`（依赖 Vue 版 editor-ui） | 保留重写 → **建议不迁，继续用 Vue**（不是聊天界面） |
| 26 | 首页推荐 | `views/Home.vue:95,175`、`api/homeSuggestions.ts:5` | 由 aui 提供（ThreadWelcome suggestions）+ 自定义卡片 |
| 27 | 草稿 | `composables/taskDraft.ts:6-53`、`views/TaskSetup.vue:111,178`、`TaskConversation.vue:141` | 由 aui 提供（`composer.setText`）+ 任务表单保留重写 |
| 28 | 澄清控件 | `components/conversation/ClarifyControls.vue:11-20`、`useConversationAdapter.ts:148-167,783-788` | 自写适配（人在回路 tool UI → `POST /clarify`） |
| 29 | 重试/编辑/分支/反馈 | `useConversationAdapter.ts:789-791`（直接返回 “Unsupported command”） | 由 aui 提供原语，但**后端没有接口**，本期不开 |
| 30 | 重试退避 | `task-conversation/vue/retryPolicy.ts:1-13` | 自写适配（原样复用） |
| 31 | Markdown + 净化 | `task-conversation/vue/MarkdownContent.vue:13-48`（`html:false`、丢弃图片、DOMPurify）、`:52-69`（`nlk.` 密封链接 → `POST /tool-link`） | 由 aui 提供（react-markdown）+ 自写适配（保留现有净化策略和密封链接） |
| 32 | 流式平滑 | `composables/useStreamSmooth.ts:25-37`（纯函数） | 由 aui 提供（纯函数也可以复用） |
| 33 | 计时 | `task-conversation/vue/executionTiming.ts:20-172`、`composables/conversationTiming.ts:5-50` | 保留重写（逻辑复用） |
| 34 | i18n | 30 个 `.vue` 文件调用 `t()`；组件自带文案表 `vue/messages.ts:3,67`；适配器里有硬编码中文 `useConversationAdapter.ts:116,218-256` | 自写适配（React 端直接调 `i18n.global.t`） |
| 35 | Pinia store | `store/conversation.ts:1,24` | 自写适配（保留 Pinia，React 端只读写） |
| 36 | 滚动跟随/回到底部 | `TaskConversation.vue:316-363` | 由 aui 提供（`ThreadPrimitive.Viewport`） |
| 37 | 错误气泡 | `components/conversation/ErrorBubble.vue` | 保留重写 |
| 38 | 设备选择 | `components/DevicePicker.vue`、`api/conversation.ts:360-366` | 保留重写 |

**计数：保留重写 19 / 由 aui 提供 9 / 自写适配 15**（跨类功能两边都计）。

附带发现：`composables/useStreamConversation.ts`（83 行）没有任何 import，是死代码，可以顺手删。

### 3.1 api 目录的后端合同（`B = /api/v1/addons/conversation`，除非注明，响应都包在 `{code,message,data}` 里）

| 文件 | 接口 | 复用 |
|---|---|---|
| `api/conversation.ts` | GET `B?beforeId&limit&agentId`（:46）· POST `B`（:66）· GET `B/:id`（:75）· GET `B/execution-backends`（:84）· GET `B/:id/messages`（不分页，:92）· POST `B/:id/follow-up {input, attachments?, providerId?, model?, executionBackend?}`（:100）· POST `B/:id/clarify`（:127）· POST `B/:id/cancel`（未运行时返回 404，:140）· DELETE/restore/deleted（:146-161）· PATCH `B/:id`（:169-205）· **GET `B/:id/messages/stream` SSE（:267）** · executor-devices（:360-366）· POST `B/:id/tool-link`（:372）· GET `B/tool-calls`（:409） | 原样复用 |
| `api/broadcast.ts` | POST `B/broadcast`、GET/follow-up/cancel `B/broadcast/:gid`（zod 校验，:48-109） | 原样复用 |
| `api/agent.ts`、`userAgent.ts`、`userAvatar.ts` | `/api/v1/addons/agent/*` | 原样复用（智能体页本期不迁） |
| `api/skill.ts`、`toolCatalog.ts`、`sessionBindings.ts` | GET `/addons/skill`、`/addons/tool/catalog`、`B/:id/bindings[/sync]` | 原样复用；`toolCatalog.ts:9` 从 `OptionSheet.vue` type-import 了 `SheetOption`，先把这个类型挪出来 |
| `api/media.ts` | `/api/v1/addons/media/models`、`generations[/:id[/cancel]]` | 原样复用 |
| `api/storage.ts`、`imageContent.ts`、`uploadPayload.ts`、`downloadUrlPolicy.ts` | 存储服务 presign → XHR 上传 → POST `/api/v1/files`；带鉴权读取 `/files/:id/content`；URL 白名单 | 原样复用 |
| `api/homeSuggestions.ts` | GET `B/home-suggestions` | 原样复用 |
| `api/types.ts` | `Conversation / Message / MessageAttachment / SSEMessageEvent …` | 原样复用 |

**SSE 帧格式**（`api/conversation.ts:220-255`、`api/types.ts:280-301`）：
```
id: <messageId>
event: message-created | message-updated | message-deleted | message-attachments
data: {…完整 Message（camelCase）…}      // deleted 时只有 {id}
```
每帧都是**整行消息，不是增量**。服务端每 15s 发一次心跳注释帧，客户端 30s 收不到任何字节就 abort 并重连（`:309-318`）；续传游标取已见过的最大消息 id（`composables/conversationStreamPolicy.ts:45-62`）；401 时调用 `handleUnauthorizedResponse`（`:282-284`）。**解码器 `streamMessages()` 只依赖 fetch 和 `getPlatformRuntime()`，React 可以原样复用。**

**纯 TS 可复用清单（5,967 行）：** api/ 全部；`task-conversation/core/*`、`toolDetails.ts`、`vue/processPresentation.ts`、`vue/executionTiming.ts`、`vue/executionPhasePresentation.ts`、`vue/retryPolicy.ts`、`vue/messages.ts`；`composables/` 下的 `useConversationAdapter`、`generation`、`chatGeneration`、`conversationNavigationCache`、`executionBackendCompatibility`、`useBroadcastAdapter`、`conversationStreamPolicy`、`taskDraft`、`conversationTiming`、`broadcastViewPolicy`、`conversationDelete`、`conversationModelRestore`、`modelErrorMessage`、`conversationBackendRestore`、`taskDesk`、`conversationNavigation`、`shellMessagePolicy`、`homeGen`、`latestRequestGate`；`components/` 下的 `pickerSearch`、`modelPickerOptions`、`attachmentPresentation`、`agentCard`；`registry.ts`。
**与 Vue 耦合的 `.ts`（1,662 行）：** `useConversation.ts` 632（容易移植）、`useShellBridge.ts` 236（保留）、`store/conversation.ts` 202（保留）、`useSessionBindings` 96、`useStreamConversation` 83（死代码）、`useStreamSmooth` 76、`useConversationDelete` 73、`useBindingSelection` 66、`bindingWriteCoordinator` 24、`attachmentRevalidation` 3，外加 `index.ts` 87 和 `task-conversation/vue/index.ts` 8（这两个是 Vue 插件清单）。

> 风险：reducer 要求 revision/seq 严格逐个 +1，否则判定为 gap（`core/reducer.ts:130-141`）；适配器里有按会话 key 存放的模块级 Map（`useConversationAdapter.ts:75-96`）。**React 端每个会话 id 只能创建一个适配器实例并保持稳定**，不能每次 render 都 new 一个。

---

## 4. 与 325 双通道后端对接（前端部分改按 React 写）

后端设计不变（`325:§B`）。React 端的落点如下：

| 325 设计 | React/aui 落点 |
|---|---|
| 发送：沿用 POST `follow-up`，快通道 `executionBackend:"fast"`（`325:§B.4`） | `ExternalStoreAdapter.onNew` → 现有 `execute({type:"send"})` → `api/conversation.ts:100`；请求体从统一下拉的当前选择算出 |
| SSE 不变：`message-*`、`Last-Event-ID`（`325:§B.3`） | 原样复用 `streamMessages()` + 适配器 + reducer；React store 订阅 reducer 状态，再经 `convertMessage` 转给 aui |
| 思考：senderName 以 `.thinking` 结尾（`325:§B.3`） | 适配器已经映射成 reasoning 项（`useConversationAdapter.ts:90-136`）→ aui 的 `reasoning` part |
| 取消：POST `cancel`（`325:§B.7`） | `onCancel`；404 视为已停止（`useConversationAdapter.ts:86`） |
| 409 → 前端排队，只排 1 条、可替换（`325:§B.6`） | 执行中 `isRunning=true`，composer 不禁用；用 aui `queue`（`createMessageQueue`）或自写一个单槽队列，收到终态事件后自动 `onNew`；如果仍收到 409，保留输入并显示“停止并发送” |
| 重新生成 = 用上一条用户消息再 follow-up 一次（`325:§B.7`），不做分支树 | 自定义 ActionBar 按钮，**不接 `onReload`**（避免 aui 默认的“替换回复/分支”语义） |
| 生图/生视频走 media generations + SSE 状态（`325:§B.8`） | 选中 image/video 组时 `onNew` 改为调用 `api/media.ts` 创建任务；消息里的 `data.media` 交给自定义 data part（`makeAssistantDataUI`）渲染成 GenMessage 卡片。在后端改成 SSE 推送之前保留 3s 轮询（`views/Conversation.vue:100-140`） |
| 统一分组下拉：聊天 / 生图 / 生视频 / 目鱼执行器 / 未分类（`325:§E`；MUYU-315） | 自写 `ModelGroupPicker`：数据来自 GET `/provider/models?type=` 和 `B/execution-backends`，分组逻辑复用 `modelPickerOptions.ts`；执行器组选中后才走沙箱通道 |
| 执行过程卡片：排队位置、阶段、命令、产物（`325:§C.3`） | 自定义 part，复用 `processPresentation.ts` / `executionPhasePresentation.ts` |
| 首字延迟打点（`325:§C.2`） | 复用 `conversationTiming.ts`；前端额外记录 `performance.now()` 从点击到首字上屏 |

## 5. 历史数据迁移

结论：**不需要迁移**，新旧前端读的是同一份数据。
- 会话和消息都存在 Core：列表 GET `B`、消息 GET `B/:id/messages`、增量 SSE（`api/conversation.ts:46,92,267`）；`325:§B.3`“历史：都存在 Core”。
- 前端没有本地持久化的消息：聊天模块里用到 localStorage 的只有任务草稿（`views/TaskSetup.vue:111,178,239`）和媒体参数偏好（`registry.ts:88`）；导航缓存只在内存里（`conversationNavigationCache.ts:19-24`）。令牌在 iframe 内也只放内存（`src/utils/token.ts:11-27`）。
- 新旧前端共用同一套接口和同一个 v2 reducer，所以同一会话两边显示一致；新旧来回切换不需要做任何数据转换。
- 剩余风险：325 引入的新消息形态（`channel=fast` metadata、媒体 SSE 推送）**旧 Vue 前端也要能正常渲染**，否则回滚后新会话会显示异常。验收里要加“旧前端打开新通道产生的会话”这一条。

## 6. 灰度与回滚

- **开关 `chatUi = vue | react`，默认 `vue`。** 判定顺序：URL `?chatUi=` > localStorage `nucleagent_chat_ui`（按用户手动选） > runtime-config 键 `CHAT_UI_DEFAULT`（按环境） > `vue`。
  - 按环境：新增 runtime-config 键，需要同步改 `runtimeConfig.ts:33-35` 的白名单、`40-runtime-config.sh:45-78` 和部署配置（属于部署仓的工作，拍板点 U4）。
  - 按用户：MVP 先用 localStorage/query（壳不参与）；以后要做服务端按用户名单，就加一个 Core 的用户偏好接口（**不在本期**）。
- 路由层：`index.ts` 里聊天路由的 loader 按开关返回 `Conversation.vue` 或 `ChatHost.vue`；React 分包只有开关打开时才加载，所以对默认用户的首屏包体积**零影响**。
- 回滚：把开关改回 `vue`（或者去掉 query/localStorage）就行，不用重新发版。Vue 视图在 React 达到功能对等并稳定两周之前**不删**。
- 部署顺序：只改 core-web，不需要壳先升级（`docs/shell-principal.md:44` 的先后约束不受影响）。

## 7. 测试策略

现有基础：105 个 `tests/*.test.ts`（`node --test`，带覆盖率门槛 80%，`package.json:9`），以及 `tests/browser/{integrated,session-renewal,editor-v2}` 下的 CDP 浏览器套件（测壳鉴权和续期，**不测聊天渲染**）。

| 类别 | 处理 |
|---|---|
| 纯逻辑单测（不受影响）：conversationStreamRecovery、executionQueue、executionTiming、conversationTiming、conversationRetryPolicy、latestRequestGate、downloadUrlPolicy、uploadPayload、imageContent、sessionBindings、attachmentPresentation、broadcastViewPolicy、conversationDelete、shellMessagePolicy、taskDesk、broadcastApi、conversationNavigation*、executionBackendCompatibility 等 | 原样保留，React 端复用同一批模块 |
| 依赖控制器的（broadcastAdapter、conversationAuthStop） | `useConversation.ts` 移植后跟着改 import，断言不动 |
| 读 `.vue` 源码文本或挂载 Vue 的（conversationSnapshotLoading、messageAttachmentDisplay、messageBodyCopy、conversationModelRestore、executionBackendPickerRestore、conversationDeleteUi、skillPicker、genCards、homeSuggestions、conversationLocale、processSummaryLayout …） | 把它们当行为规格，逐条改写成 React 组件测试；Vue 版测试保留到 Vue 视图删除为止 |
| E2E（新增，后续棒做） | Playwright 跑两次（`?chatUi=vue` 和 `?chatUi=react`），同一套用例：325 §G.1 的 10 条，加上本方案的 MVP 验收（§9）和“旧前端读新会话”。壳鉴权沿用 `tests/browser/integrated` 的独立宿主方式，令牌只经 postMessage 传入，不写文件 |
| 传输 | `tests/integration/nginxStream.test.mjs`（SSE 经过 nginx 不被缓冲）保留 |

## 8. 工作量与分期（估算，非排期）

| 阶段 | 内容 | 任务数 | 周（单人） |
|---|---|---|---|
| P0 MVP | 工程接入（plugin-react、tsconfig、分包、开关、`ChatHost.vue`）；React store 包装 `useConversation` 控制器；ExternalStore 适配（`convertMessage`、onNew/onCancel/isRunning）；Thread/Composer/Markdown 基本样式；模型分组下拉（chat/image/video/执行器，数据来自现有接口）；度量脚本 | 6 | 2 |
| P1 对等 | 过程卡片/阶段/排队位置；工具卡片和思考折叠；附件 Adapter + 图片预览；澄清；产物；生图/生视频卡片；409 单槽排队；重新生成按钮；错误气泡；i18n 全量；组件测试改写 | 9 | 3–4 |
| P2 外围 | 首页/任务表单（TaskSetup）、多后端对比（broadcast）、最近删除、设备选择、技能/工具绑定 | 5 | 2 |
| P3 验收 | 双开关 E2E、性能/包体积/视觉对比报告、TEST/PRE 灰度、默认值切换 | 2 | 1 |
| **合计** | | **22** | **约 8–9 周单人；两人并行约 5 周** |

智能体页（AgentList/AgentInstance/UserAgentWizard）依赖 Vue 版 editor-ui，**建议不迁**（拍板点 U3）。不迁的话可以从上表减掉约 1 周。

## 9. MVP 范围与验收标准

**范围：** 只做 `/c/:id` 和 `/chat` 新建会话两条路由；开关默认 `vue`。

| # | 验收项 | 判定 |
|---|---|---|
| M1 | 登录态由壳传令牌 | 在壳内以 `?chatUi=react` 打开，不需要另外登录；令牌只出现在内存和 Authorization 头里，localStorage、日志、console 里都没有；壳续期（换 sessionVersion）后请求自动使用新令牌；401 能触发 `auth-required` |
| M2 | 发送 | 新建会话、追问都成功；乐观气泡出现后由服务端消息替换，不重复 |
| M3 | 流式 | SSE 推送的 `message-updated` 逐步上屏；断网 30s 恢复后自动续传，不丢消息也不重复（复用 conversationStreamRecovery 的语义） |
| M4 | 取消 | 运行中点停止 → 状态变为 cancelled，可以立即再次发送；对已结束的会话发 cancel 返回 404 时不报错 |
| M5 | 历史列表 | 壳侧栏照常更新（Pinia → `conversations` 消息）；打开旧会话完整显示；同一会话在 vue/react 两边切换显示一致 |
| M6 | 模型选择器分组 | 分组来自 Toolgate 类型（GET `/provider/models?type=chat|image|video`）加执行后端列表；切换后 PATCH 生效；选中 image 组时只出现 image 模型 |

**度量方法：**
- **首字延迟**：Playwright 记录 `performance.now()` 从点击发送到首个正文字符出现在 DOM 的时间。同一模型、同一时段 vue/react 交替各跑 30 次，丢掉第一次，报 p50/p95。**目标：react 的 p50 不超过 vue p50 + 50ms**（只比较前端渲染开销；后端开销按 325 §C 单独评估）。
- **包体积**：`vite build` 后统计①默认路径（开关关）首屏 JS 的 gzip 大小，**要求与基线 `c0a82a7` 的差异 ≤ 1 KB**；②React 聊天分包的 gzip 大小，单独报告，目标 ≤ 180 KB（目标值为估计，需拍板 U5）。
- **视觉一致性**：固定 5 个场景的截图（空会话、长 Markdown、思考展开、过程卡片、错误气泡），对照设计规范 tokens 逐项检查（字体、字号、字重不用 600、圆角、主色、焦点环）；人工比对 vue/react 截图并记录差异。用户界面里不出现 lucide 图标。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 设计规范明确“不授权换栈” | 用户在工单上书面确认（U1） |
| assistant-ui 还是 0.x，很多 API 标着 Experimental | 锁定精确版本；只用 ExternalStore 的核心字段（messages / convertMessage / onNew / onCancel / isRunning / adapters.attachments）；升级前跑组件测试 |
| Vue + React 同时打包 | React 分包懒加载、开关关时零增量；Vue 视图删掉之后再评估是否全部迁走 |
| CSS 互相污染（全局的 `task-conversation/styles.css`、editor-ui CSS） | 统一 `mc-` 前缀，不用 preflight；React 区域不复用旧类名 |
| 适配器模块级 Map 与 React 重渲染冲突（`useConversationAdapter.ts:75-96`） | 每个会话 id 只创建一个适配器（用 ref 缓存），挂载/卸载在 `ChatHost` 一侧管理 |
| aui 默认的附件实现会把文件内联进消息 | 自写 AttachmentAdapter，只走 presign 上传；文件内容不进前端消息状态 |
| 第三方外连（cloud renderer、safe-content-frame） | 不使用；CSP 不放行 `*.assistant-ui.com` / `*.auiusercontent.com`；MVP 构建后 grep 产物确认 |
| 325 后端（fast 通道、媒体 SSE）与前端重写同时进行 | 前端只依赖现有接口就能完成 MVP；fast 通道就绪后只是多一个下拉取值 |
| 回滚后旧前端渲染新通道的消息 | 验收加一条“旧前端读新会话” |

## 11. 未能核实项

> 2026-11-13 第 3 棒更新：第 2、3、5、6 项已实测核实，结论见 §15。

1. assistant-ui 官方文档站（www.assistant-ui.com）和 GitHub 仓库页：当天网络不可达（connection reset），**NOT_VERIFIED**。所有 aui 结论只来自 npm 包源码。
2. ~~aui 的完整传递依赖许可证树~~ **已核实**（§15.1）。
3. ~~aui 分包在本项目里的实际 gzip 体积和 tree-shaking 效果~~ **已核实**（§15.2，§14.3）。
4. `@assistant-ui/react-markdown` 平滑流式参数的确切名称和行为（未用该包，仍未核实）。
5. ~~aui `queue`（`createMessageQueue`）的语义是否满足“只排 1 条、可替换”~~ **已核实：不满足，已自写单槽**（§15.3，§14.5）。
6. ~~React 与 vue-i18n 直接共用的响应式更新方式~~ **已核实**（§15.4）。
7. `git push`：见提交说明（github 不可达）。
8. matrix 中 tests 的说明来自测试名和 import，没有逐个读完测试体。

## 12. 需用户拍板点

| # | 背景 | 选项 | 代价 | 倾向 |
|---|---|---|---|---|
| U1 | 设计规范 `skill:SKILL.md:54`：“不授权把 Vue 仓迁到 React；换栈要另立需求，经用户批准” | a. 在 MUYU-365 工单上书面确认授权（只限 core-web 聊天区） b. 暂缓 | a 无 | **a** |
| U2 | 宿主形态 | ① 全量 React ② 进程内 React 岛 ③ 独立入口 | ① 约 31.7k 行、无法灰度；③ 要改壳/通道 | **②** |
| U3 | 智能体页（依赖 Vue 版 editor-ui）是否迁 | a. 不迁，保持 Vue b. 一起迁（还要替换 editor-ui） | b 多约 1–2 周，还要动 prism-fusion | **a** |
| U4 | 按环境的开关是否加 runtime-config 键 `CHAT_UI_DEFAULT` | a. 加（改白名单 + entrypoint + deploy） b. 只用 query/localStorage，环境切换靠发版 | a 涉及部署仓一处小改 | **a**，P3 再加 |
| U5 | React 分包的体积预算 | a. ≤180 KB gzip b. 不设硬线，只公示 | a 可能需要裁剪 markdown/高亮 | **a**（MVP 先测再定） |
| U6 | 重新生成/编辑/分支 | a. 只做“重新生成 = 再发一轮”（325 §B.7） b. 后端加分支，启用 aui BranchPicker | b 要大改 Core 的消息模型 | **a** |
| U7 | 默认值切到 react 的条件 | a. P1 对等 + 双开关 E2E 全绿 + TEST 灰度 2 周 b. 更早 | — | **a** |
| U8 | 用户卡是否借这次改用壳的 `/remote/account-ui.js` | a. 本期不动 b. 一起接入（参考 im-web） | b 多 2–3 天 | **a** |

## 13. MVP 结果（第 2 棒，2026-11-13）

> 代码：`f1c8b63`（依赖与构建）、`ba7baca`（React 岛 MVP）。验收在 `ba7baca` 的 `npm run build` 产物上进行。

### 13.1 做了什么

- 开关：`?chatUi=react` 或 localStorage `nucleagent_chat_ui=react` 时，`/chat`、`/c/:id` 加载 `views/ChatHost.vue`，懒加载 `src/chat-react/mount.tsx` 后用 `createRoot` 挂载；其它情况仍是原 Vue 视图（`src/chat-react/chatUi.ts`）。runtime-config 键 `CHAT_UI_DEFAULT` 未加（U4）。
- 运行时：`useExternalStoreRuntime`。**原 `useConversation` 控制器原样复用**（快照、`streamMessages` SSE 解码、v2 reducer、乐观发送、停止、重连），只是放在一个脱离组件的 Vue `effectScope` 里跑，React 订阅它的 state（`useCoreConversation.ts`）。对 `useConversation.ts` 只改了一行：不在组件里时不注册 `onBeforeUnmount`。
- 适配层 `threadMessages.ts`：沿用 `selectTurns` 的可见性规则；每条用户消息一条 user message，两条用户消息之间的条目合成一条 assistant message（process → `reasoning` part，answer/system → `text` part），状态映射到 aui 的 running / complete / incomplete(cancelled|error)。
- 发送失败抛 `MessageNotSentError`，aui 会把草稿还给输入框。
- 模型分组下拉 `modelGroups.ts`：聊天 / 生图 / 生视频来自 Toolgate 类型目录（复用 `pickerOptions`），执行器来自 `GET execution-backends`；改选后 PATCH，与 `Conversation.vue` 同一接口。生图/生视频只列出、置灰（MVP 不触发收费调用）。
- 令牌：React 不碰令牌，所有请求走原 `http`/`streamMessages`（`getPlatformRuntime`）；会话变更事件沿用 TaskConversation 的策略（续期保留历史，登出 dispose）。
- 样式：`chat-react/chat.css`，只用 aurora 变量和 `mc-` 前缀，无全局 reset、无 Tailwind；字重只有 400/500。
- Markdown 净化策略抽成 `task-conversation/markdown.ts`，Vue 与 React 共用同一份（行为不变）。

### 13.2 测试与构建

| | 基线 `6eaacd0` | 改动后 `ba7baca` |
|---|---|---|
| `npm run test:unit` | 850 项：824 通过 / 0 失败 / 26 跳过；覆盖率门槛通过 | 856 项：830 通过 / 0 失败 / 26 跳过；覆盖率门槛通过 |
| `vue-tsc -b && vite build` | 通过 | 通过 |

新增 `tests/chatReactAdapter.test.ts`（6 项）：开关优先级、Core→aui 消息映射、经真实控制器的流式累积与取消、发送失败还原草稿、模型分组（含旧 Core 回退）、aui 组件经 ExternalStoreRuntime 渲染（`react-dom/server`）。做过变异检验：把 `isRunning` 改成恒 false、或让 `onNew` 不发送，相关用例都会失败。

依赖：`react`/`react-dom` 19.3.1、`@assistant-ui/react` 0.15.36、`@types/react(-dom)` 19.3.0、`@vitejs/plugin-react` 4.7.0，全部精确锁定。副作用：aui 要求 `zod ^4.6.7`，lock 里 zod 4.6.5→4.6.7，`@babel/parser`/`types` 7.29.8→7.29.14。

### 13.3 包体积（gzip，`node scripts/muyu365-bundle-size.mjs dist <基线dist>`；表中 KB = 1024 B）

| 项 | 基线 | MVP | 差值 | 目标 |
|---|---|---|---|---|
| 默认路径 `/chat`（入口 + Home 的静态依赖） | 202.42 KB | 203.41 KB | **+1015 B** | ≤ 1 KiB：达标（余 9 B） |
| 默认路径 `/c/:id` | 278.20 KB | 279.49 KB | **+1318 B** | ≤ 1 KiB：**未达标**（超 294 B） |
| React 岛额外加载（`ChatHost` + `mount`，开关打开才下载） | — | **182.33 KiB**（约 186 707 B；Vite 显示 `mount` 186.01 kB） | — | ≤ 180 KB（U5）：**超出**（按 KiB 超 2.3，按 kB 超 6.7） |
| 全部 JS | 401.81 KB | 585.54 KB | +183.72 KB | — |

默认路径增量来源：`main` +564 B（zod 补丁版本约 160 B、开关判定、两个新分包名进了预加载表），其余是 Rollup 重新切块（`useConversation` 被拆成 React 岛与 Vue 共用的独立分包）。要压到 1 KB 内，可以把开关判定移出 `main`，或给 `useConversation` 固定 `manualChunks`；本棒没做。

### 13.4 首字延迟

方法：`tests/browser/muyu365-chat-react.cjs` 在壳内打开会话，`MutationObserver` 记录从点击发送（捕获阶段）到新的助手气泡出现首个字符的 `performance.now()` 差值；提示词固定为“只回复一个字：好”，每个视图先新建会话再追问 N 次，取中位数。

| 视图 | 新建会话首条 | 追问 | 中位数 |
|---|---|---|---|
| React | 25 326 ms | 3 530 ms | 3 530 ms（2 个样本取较小） |
| Vue | 25 961 ms | 4 073 ms | 4 073 ms |

**结论有限**：每边只有 2 个样本，而且首条耗时被排队与 Agent 初始化（约 25 s，后端）主导，前后端差异远小于后端波动；React 一侧的 t0 是 Enter 按键、Vue 一侧是点击（脚本已统一为点击，下次跑一致）。§9 要求的“各 30 次交替、报 p50/p95”**没有跑**（费用约束）。脚本支持 `--n 30` 直接复跑。

### 13.5 TEST 验收（层级：**TEST 壳 + TEST 后端 + 本地构建产物**）

做法：在自己的业务浏览器（`biz-browser open --task MUYU-365 --env test`，端口 9465，主账号 880723，已 close）里打开真实 TEST 壳 `nucleagent-web.debug.ndaeweb.com`，用 Playwright 的请求拦截把 **TEST core-web 源的静态文件**（HTML 与 `/assets/*`）换成本 worktree 的 `dist`；`/api`、`/runtime-config.json` 原样直连 TEST，令牌只经壳的 postMessage 握手进入 iframe。**没有部署任何东西**，所以这不是“TEST 已发布页面”的验收，而是“真实壳 + 真实后端 + 本地前端产物”。

| 验收项 | 结果 |
|---|---|
| M1 令牌由壳传入，不另外登录 | 通过。请求都带壳下发的 Authorization；core-web localStorage 只有 `nucleagent_chat_ui / nucleagent_locale / nucleagent_session_version`，令牌不在其中；console 里没有令牌。续期/401 未在 TEST 上触发验证（只有单元层的既有用例） |
| M2 发送 | 通过。React 新建会话 1130 并追问 1 次；乐观气泡被替换，用户气泡数 = 2，没有重复 |
| M3 流式 | 部分。SSE 更新逐步上屏（同一套解码器与 reducer）；断网 30 s 续传**未在 TEST 上测** |
| M4 取消 | 通过。运行中点“停止”，按钮回到“发送”，会话显示“排队已取消”；Vue 打开同一会话显示“已停止” |
| M5 历史 | 通过。壳侧栏照常出现新会话；Vue 视图打开 React 写的会话 1130，内容完整一致 |
| M6 模型分组 | 通过（读取）。TEST 返回 聊天 94 / 生图 24 / 生视频 51 / 执行器 6；切换后的 PATCH **未在 TEST 上点**（避免改动会话设置） |

截图（`docs/muyu365-evidence/`，已逐张打开核对，无令牌/账号信息；`vue-empty.png` 里有他人测试任务的标题）：`react-empty.png`、`react-conversation.png`、`react-cancelled.png`、`vue-empty.png`、`vue-conversation.png`、`vue-reads-react-conversation.png`；结构化结果 `acceptance.json`。

费用：共 5 次短文本调用（React 2 次 + 1 次在排队阶段被取消；Vue 2 次），默认模型、Codex Agent；没有生图/生视频。按每次几万 token 上下文粗估合计 **< ¥3**，未从账单核实。

### 13.6 视觉一致性（人工对比截图）

一致：Noto Sans SC、14px 正文、品牌色 `#3072FF` 系、圆角 16/999、输入框聚焦光晕、亮色背景。
差异（P1 补）：React 没有头像、时间戳、复制按钮；过程条目是每条一个折叠行（“排队等待”“Agent 初始化”），Vue 是合并的“执行过程 N 个步骤 · 总耗时”；用户气泡是浅蓝底深字，Vue 是品牌蓝底白字；没有会话标题栏与“更多”菜单；没有生图/生视频入口和附件按钮。

### 13.7 未完成与偏差

- 未完成：附件、澄清、工具卡片、产物、生图/生视频、多后端对比、删除/最近删除、首页建议卡、i18n 全量；断网续传与续期的 TEST 实测；§9 的 30 次延迟采样；E2E 双开关回归。
- 偏差：
  1. 测试框架是仓内的 `node --test` + Vite SSR，**不是 vitest**（仓里没有 vitest，按“沿用仓内框架”处理）；组件测试用 `react-dom/server` 渲染，没有引入 jsdom。
  2. 控制器没有移植成 `useSyncExternalStore` store，而是把 Vue 版原样放进 `effectScope`——改动最小，但 React 岛因此仍依赖 `vue` 运行时（本来就在包里）。
  3. 模型下拉是“模型 + 执行器”两个 `<select>`，不是 325 §E 设想的单个统一下拉，因为会话把两者分开存。
  4. 包体积：`/c/:id` 默认路径 +1318 B、React 岛 182.3 KiB，都略超目标（见 13.3）。第 3 棒已回收到 +788 B / 172.92 KiB（§14.3）。
- 浏览器验收脚本放在 `tests/browser/muyu365-chat-react.cjs`，沿用 nucleagent-web 的 `*.cjs` + `connectOverCDP` 写法；依赖调用方传入 playwright-core 路径（仓内不装）。

## 14. 第 3 棒结果（2026-11-13）

> 提交：`0597b11` 视觉追平、`970bc32` CHAT_UI_DEFAULT、`03df1cf` 体积回收、`8390852` 附件、`45f9cd8` 单槽排队、`45895f5` i18n 收尾。默认行为（开关关）不变。

### 14.1 视觉追平（`0597b11`）

消息行按 `MessageItem.vue` 做：28px 头像、作者、精确到秒的时间、复制按钮（含“已复制/操作失败”状态）、单层气泡；用户气泡改成品牌渐变底白字。连续的过程条目合成一个 `data-process` part，渲染成一行“执行过程 N 个步骤 · 总耗时”，用的是 Vue 视图同一套 `processGroupSummary / orderTurnItemsForDisplay / executionTimings`。复制逻辑（会话重验 + 过期结果丢弃）和时间格式抽到 `components/conversation/messageCopy.ts`，Vue 与 React 共用，Vue 行为不变。§13.6 的差异里，标题栏/“更多”菜单、生图/生视频入口仍未做。

### 14.2 CHAT_UI_DEFAULT（`970bc32`）

- 优先级：URL `?chatUi=` > localStorage `nucleagent_chat_ui` > runtime-config `CHAT_UI_DEFAULT` > 默认旧视图（`src/chat-react/chatUi.ts:4-25`）。
- `src/runtimeConfig.ts:11` 把键加进白名单，`:52-57` 只接受 `old` / `react`，缺失或空串就省略，所以已有的 runtime-config 照常解析。
- `docker-entrypoint.d/40-runtime-config.sh:76-81` 只在设置了环境变量时写入该键，其它值启动直接失败。
- 测试：`tests/runtimeConfig.test.ts`、`tests/browserRuntimeConfig.test.ts`、`tests/chatReactAdapter.test.ts` 的开关用例。

### 14.3 体积实测（gzip，`node scripts/muyu365-bundle-size.mjs dist <c0a82a7 的 dist>`，KB = 1024 B，`45895f5` 构建）

| 项 | 基线 `c0a82a7` | `45895f5` | 差值 | 目标 |
|---|---|---|---|---|
| 默认路径 `/chat` | 202.59 KB | 202.83 KB | **+247 B** | ≤ 1 KiB：达标 |
| 默认路径 `/c/:id` | 278.38 KB | 279.15 KB | **+788 B** | ≤ 1 KiB：达标 |
| 默认入口 | — | 159.37 KB | +285 B | — |
| React 岛额外加载（`ChatHost` + `mount`） | — | **172.92 KiB gzip / 147.47 KiB brotli** | — | ≤ 180 KiB（U5）：达标 |
| 全部 JS | 401.97 KB | 573.89 KB | +171.92 KB | — |

手段（`03df1cf`）：`output.experimentalMinChunkSize: 500` 把拆出来的小共享分包并回 Vue 一侧；岛内专用文案从主 i18n 包移到 `ChatApp.tsx`；aui primitives 按文件深路径引入（`src/chat-react/auiPrimitives.ts`，经 `@aui-dist` 别名），不再用命名空间对象。shortcut：深路径绑定精确锁定的 0.15.36，升级 aui 时要复核。§13.3 的 182.33 KiB 降到 170.4 KiB；之后附件和排队又加了约 2.5 KiB。

可选优化（未做）：§15.2 的第 1 项，不用 `ComposerPrimitive.Input`，改成自家 `<textarea>`，预计再省 6–8 KB。现在已达标，余量 7 KiB，所以本棒不做。

### 14.4 附件（`8390852`）

`src/chat-react/attachments.ts` 的 `storageAttachmentAdapter` 是 aui `AttachmentAdapter`，复用 Vue `AttachmentPicker` 的 `uploadFile`（预签名 → 直传 → 登记）。行为：
- 选中文件即上传并显示进度；单个文件上限 100 MB；上传失败按文件提示。
- 发送时只带存储引用（fileId / name / mime），`content: []`，文件字节不进入消息状态。
- 追问走 `useConversation.send`，新建会话走 create 载荷；数量上限是 Core 的 `MAX_ATTACHMENTS`。
- UI：回形针按钮 + chips（进度 / 失败 / 移除），用户消息上列出附件名。附件下载和预览仍由 Vue 的 `AttachmentChips` 负责，React 岛没做。

测试在 `tests/chatReactAdapter.test.ts`，两项：上传适配器的进度 / 引用 / 失败；onNew 透传引用，历史中显示附件。

### 14.5 单条可替换排队（`45f9cd8`，325 §B.6）

- `src/chat-react/singleSlotQueue.ts`：自写 `ExternalThreadQueueAdapter`，只有一个槽。
  - `enqueue` 和 `steer` 都是“有槽就替换内容（id 不变），没槽就新建”。steer 不打断当前运行，想“停止并发送”就用 Cancel。
  - `remove` 清空槽；`move` 不做任何事。
  - `__internal_notifyCancelled` 会暂停队列：取消后槽内消息保留，但不会自动发出。之后再发送一条会替换槽内消息，并重新开始自动发送。
  - `useSingleSlotQueue` 在 `isRunning` 由真变假且未暂停时把槽发出去，只发一次。
- `externalStore(…, slot)` 传入 slot 后才有 `queue` 能力。`onNew` 收到 409 时把消息放回槽里，不抛 `MessageNotSentError`；冲刷时再遇到 409 也留在槽里，等下一次运行结束。其它错误照旧把草稿还给输入框。
- UI：运行中也显示“发送”。`ComposerPrimitive.Queue` + `QueueItemPrimitive.Text/Remove` 显示“待发送 1 条 · 内容 · ×”。新建会话页没有队列。
- 没用 aui 的 `createMessageQueue`：它是多条 FIFO，而且传了 `cancel` 时 steer 会打断运行（§15.3）。
- shortcut：空闲时如果槽里有取消后留下的消息，新发送会替换它并立即发出；没有“原样发送槽内消息”的按钮。
- 测试：`tests/chatReactQueue.test.ts` 5 项（替换且 id 不变、清槽、取消后不冲刷且再发送会重新开始自动发送、冲刷遇 409 回槽、运行结束只冲刷一次），`tests/chatReactAdapter.test.ts` 1 项（onNew 409 回槽，其它错误仍是 MessageNotSentError，不传 slot 则没有 queue）。
- 未验证：没有在浏览器 / TEST 上点过排队，只有单元层验证。

### 14.6 i18n（`45895f5`）

岛内最后一处硬编码中文（ZodError 提示）改成 `t("chatReact.badUpdate")`，中英文都放在 `ChatApp.tsx` 的 `STRINGS` 里。和 `03df1cf` 一样，岛内专用文案放在懒加载分包，不进主 i18n 包，避免默认路径变大，所以没有写进 `zh.ts` / `en.ts`。没有做方案 B（`useT()`）：现在由 `ChatHost` 注入 `t` + `watch(locale)` 的做法已经可用（§15.4）。

另有一处遗留：`attachments.ts:25,48,56` 有 3 处中文错误文案，是附件上传的提示，未国际化。

### 14.7 测试与构建

| | 基线（第 3 棒前） | `45895f5` |
|---|---|---|
| `npm run test:unit` | 863 项：837 通过 / 0 失败 / 26 跳过 | **869 项：843 通过 / 0 失败 / 26 跳过**；覆盖率门槛通过 |
| `vue-tsc -b && vite build` | 通过 | 通过 |

新增的 6 项都是排队测试。

### 14.8 视觉自检脚本

前一位 worker 留下了未跟踪的 `scripts/muyu365-react-selfcheck.mjs`，运行时报 “must be used within ThreadPrimitive.Viewport”。已修好并提交：外层改成 `ThreadPrimitive.Root`；输入框改为同 class 的普通 `<textarea>`，因为 `ComposerPrimitive.Input` 在这个 SSR 页里拿不到 Viewport 的滚动 store。用法：`node scripts/muyu365-react-selfcheck.mjs out.html`，用 mock 数据渲染，不联网、不用令牌，生成带 aurora.css + chat.css 的静态页。已核对输出含 2 条消息行、1 个合并的“执行过程”行、头像、复制按钮、附件名。**视觉截图比对没有做**：本棒没有打开浏览器截图，只检查了 HTML 结构。

## 16. 入口改造（第 4 棒，2026-11-13）

> 提交：`41e1614` chatUi 读 hash 参数并持久化、`5b55333` 壳在 Core 启动后才送来 `?chatUi=` 时的处理。默认行为（无参数、无 localStorage、无 `CHAT_UI_DEFAULT`）仍是旧 Vue 视图。

### 16.1 TEST 上实测的入口现状（第 4 棒之前，发布 worker 读回）

1. 在壳里访问 `https://nucleagent-web.debug.ndaeweb.com/chat?chatUi=react`，壳会把参数转给 core-web iframe，但放在 **hash** 里（`…/#/chat?chatUi=react`）。旧的 `chatUi()` 只读 `location.search`，所以仍是 Vue。
2. 直接访问 core-web 域名会被跳回壳，这条路走不通。
3. 在 iframe 里设 localStorage `nucleagent_chat_ui=react` 再刷新，可以进入 React 版（已走通）。

### 16.2 改动

- `src/chat-react/chatUi.ts` 的 `chatUi()`：
  - 优先级：`location.search` 的 `chatUi` > `location.hash` 中第一个 `?` 之后的 query 的 `chatUi`（兼容 `#/chat?…`、`#/c/1133?…`、多参数；不把整个 hash 交给 URLSearchParams）> localStorage > runtime-config `CHAT_UI_DEFAULT` > vue。非法值一律忽略。
  - 持久化：URL 中出现合法的 `react|vue` 时写入 localStorage `nucleagent_chat_ui`。`vue` 选择**写入 vue**（不清除），这样在 `CHAT_UI_DEFAULT=react` 的环境里 `?chatUi=vue` 也能稳定回到旧版。
  - localStorage 读或写抛异常：URL 值只对本次加载生效，否则走 runtime 默认值。写入只发生在 core-web 源下，只写这一个开关值，不涉及令牌。
- 壳内时序问题（读壳代码时发现，`5b55333`）：
  - 壳的 iframe `src` 是固定的 `SUB_APPS.core.url`（`nucleagent-web/src/runtime/RemoteFrame.vue:70`），所以 Core 先以 `#/chat` 启动。
  - 握手 ready 后，壳才通过 `view` 消息把 `?chatUi=react` 送进来（`CoreRemoteHost.vue:41`），Core 再 `router.push` 到 `/chat?chatUi=react`。
  - 这时 `/chat` 的组件已经解析过，vue-router 会缓存它，原来的开关不会再次求值。
  - 处理办法：`loadedChatUi()` 规定每次页面加载只做一次选择。`conversation` 插件注册一个 `router.beforeEach` 守卫，调用 `followChatUiQuery`，对目标路由的 `chatUi` 查询做如下处理：
    - 还没做过选择：直接采用并持久化。
    - 已选的 UI 与请求一致：不处理。
    - 请求另一种 UI：先 `history.replaceState` 到带参数的 URL，再 `location.reload()`。重载后的 URL 带着参数，启动时直接选中，不会循环。
  - 插件 `destroy` 时移除该守卫。
- 测试（`tests/chatReactAdapter.test.ts`，新增 2 项）：
  - hash 变体（含 `#/chatUi=react`、`#chatUi=react` 这类没有 query 的写法）。
  - search 优先于 hash，hash 优先于 storage 和 runtime 默认值。
  - 非法值忽略且不写入。
  - 持久化后 hash 被改写时选择不丢；`?chatUi=vue` 写入 vue，并覆盖 `CHAT_UI_DEFAULT=react`。
  - storage 读写抛异常或不可用时降级。
  - 无参数时默认 vue。
  - 启动后才到达的查询：先锁定，再请求另一种 UI 时只重载一次，非法值忽略。
- 变异检验：
  - 共 10 个变异，全部被测试杀死。
  - `41e1614` 的 6 个：hash 优先于 search、忽略 hash、整个 hash 交给 URLSearchParams、只持久化 react、不持久化、storage 被阻断时丢掉 URL 值。
  - `5b55333` 的 4 个：总是重载、从不重载、未选时就重载、不校验取值。

### 16.3 壳侧透传结论（只读 `nucleagent-web@607c4ca` 的 `src/addons/core-remote/*`，未改壳）

- **会透传**：壳在 iframe ready 时发一次 `view`，此后壳路由每次变化（`watch(route.fullPath)`，`CoreRemoteHost.vue:109-113`）也会发。消息里的 `path` 由 `router.resolve({ path: childPath, query: route.query })` 生成，**包含壳 URL 当前的全部 query**。因此只要壳地址栏里还有 `?chatUi=`，每次都会转给 Core。
- **不会长期保留**：
  - 侧栏点击、Core 上报的会话提升（`conversationParentPath` → `router.replace('/chat/:id')`）、`view-changed` 跟随，生成的都是不带 `chatUi` 的路径，壳 URL 里的参数随之消失。
  - Core 内部路由跳转同样会改写 hash。
  - 所以**不能依赖壳持续透传**。本棒的做法是首次见到参数就写入 localStorage，之后不带参数也保持选择。
- 由此带来的行为：参数从 URL 消失后，下一次 `view` 不再带 `chatUi`，Core 不做处理，继续用已选 UI；刷新后读 localStorage，结果一致。

### 16.4 新入口用法与回退

- 进入 React 版：在壳里打开 `https://nucleagent-web.debug.ndaeweb.com/chat?chatUi=react`。如果 iframe 已用 Vue 启动，会自动重载一次进入 React，并记住选择，之后不带参数也是 React。
- 回到旧版：打开 `…/chat?chatUi=vue`，同样会重载一次并记住 vue。也可以在 iframe 里删除 localStorage 的 `nucleagent_chat_ui`（这时回到 `CHAT_UI_DEFAULT` 或 vue）。
- 隐私模式或禁用 storage：参数只对当前页面加载生效，路由跳转后保持，刷新后丢失。
- **未在 TEST 上验证**：本棒不发布、不部署，上面的流程只做了单元层验证，需由下一棒发布后在壳里实点确认。

### 16.5 测试、构建与体积（gzip，KB = 1024 B，`5b55333` 构建；两个基线都在本机用同一 node_modules 现场构建）

| 项 | vs `c0a82a7`（MUYU-365 前） | vs `af58d0d`（第 4 棒前） | 目标 |
|---|---|---|---|
| 默认路径 `/chat` | +414 B | +167 B | — |
| 默认路径 `/c/:id` | **+963 B** | +175 B | ≤ 1 KiB：达标（余量 61 B） |
| 默认入口 | +489 B | +204 B | — |
| React 岛额外加载 | 172.92 KiB | 不变 | ≤ 180 KiB |

- 判定逻辑约 200 B，仍放在 main，没有挪进懒加载包。原因是它决定加载哪个包，挪进去就需要先加载岛才能判定。注意 `/c/:id` 的 1 KiB 余量只剩 61 B，后续再往默认路径加东西就要先腾空间。
- `npm run test:unit`：基线 869 项（843 通过 / 0 失败 / 26 跳过），现在 **871 项（845 通过 / 0 失败 / 26 跳过）**，覆盖率门槛通过。
- `npx vue-tsc -b && npx vite build`：通过。

## 15. 4 项未核项核实结论

> 来源：独立核实 worker 的报告，原文见 `docs/muyu365-verification-report.md`（基线 `64152ff`）。数值以本节标注的最新实测为准。

### 15.1 许可证全树

- **结论**：达标，生产包里没有 copyleft。
- **证据**：
  - package-lock 的生产闭包共 184 个包：MIT 173、BSD-3 3、ISC 2、BSD-2 2、0BSD 1、Python-2.0 1、(MPL-2.0 OR Apache-2.0) 1、无 license 字段 1。
  - `license-checker --production` 交叉核对，结论一致。
  - 非常见许可证逐个读了原文：
    - `argparse`：PSF，宽松许可，只给 markdown-it 的 CLI 用。
    - `dompurify`：MPL/Apache 二选一，选 Apache-2.0。
  - 相对 `c0a82a7` 新增 92 个生产包：90 个 MIT，另有 `secure-json-parse` BSD-3 和 `tslib` 0BSD。
  - dev 包里唯一的非宽松许可是 `caniuse-lite`（CC-BY-4.0），只在构建期用。
- **后续**：
  - 唯一需要确认的是 vendored `@prism-fusion/editor-ui@0.1.0`：没有 LICENSE 文件，也没有 `license` 字段。这与本单无关（`c0a82a7` 就已存在）。
  - 可在 CI 加 `npx license-checker --production --failOn 'GPL;AGPL;LGPL;CC-BY-SA'`。

### 15.2 React 分包真实体积

- **结论**：已达标，按 `45895f5` 实测：React 岛 **172.92 KiB gzip / 147.47 KiB brotli**，默认路径 `/c/:id` +788 B。核实报告当时（`64152ff`）是 182.33 / 154.49 KiB，`/c/:id` +1318 B，第 3 棒已回收到上述数值（§14.3）。
- **证据**：用 sourcemap 把字节按源模块归属：
  - assistant-ui 全家约 61%：core ≈67 KB、react ≈19、assistant-stream ≈11、store ≈8、tap ≈6。
  - React 运行时约 37%（react-dom ≈63 KB）。
  - markdown-it / dompurify / zod / vue-i18n 不在岛内独占部分，和 Vue 共用。
  - aui 各包都是 `sideEffects:false`，tree-shaking 已生效。
  - nginx.conf.template 里没有 gzip/brotli 配置，线上实际按哪种压缩传输未核实。
- **后续（可选）**：
  - 不用 `ComposerPrimitive.Input`，预计省 6–8 KB。它引入 `react-textarea-autosize`、radix 和 trigger popover，见 `node_modules/@assistant-ui/react/dist/primitives/composer/ComposerInput.js:10-17`。
  - `ComposerPrimitive.Root` 换成 `<form>`，约 0.5–1 KB。
  - react-dom 换 preact 风险大，不建议。

### 15.3 单条可替换排队

- **结论**：aui 提供了队列管道，但 `createMessageQueue` 不是单槽语义，所以自写了，已实现（§14.5）。
- **证据**（`node_modules/@assistant-ui/core/src/…`）：
  - 传 `ExternalStoreAdapter.queue` 后 `capabilities.queue = true`（`runtimes/external-store/external-store-adapter.ts:202-203`、`external-store-thread-runtime-core.ts:588`）。
  - 不传 queue 时运行中禁用发送（`store/primitive-predicates.ts:13-18`）。
  - 有 queue 时运行中发送走 `queue.steer`，空闲时走 `enqueue`（`external-store-thread-runtime-core.ts:1204-1206`）。
  - 取消时调用 `__internal_notifyCancelled`（`:1541,1580`）。
  - `createMessageQueue` 的 push 是多条 FIFO（`runtime/queue/message-queue.ts:321-330`）；传了 `cancel` 时 steer 会取消当前运行再插队（`:336-345`）。
  - ExternalStore runtime 不会替宿主调用 `notifyBusy/notifyIdle`（只有 LocalRuntime 会，`local-thread-runtime-core.ts:929,938`）。所以由我们自己在 `isRunning` 的下降沿冲刷。
- **后续**：在浏览器或 TEST 上点一遍排队（运行中发送 → 替换 → 移除 → 取消 → 运行结束自动发出）。

### 15.4 i18n 共用

- **结论**：支持，已实测。
- **证据**：
  - `ChatHost.vue:16-32` 用 `useI18n().t` 注入，`watch(locale)` 触发重渲染。
  - 无组件上下文时 `i18n.global.t` 可用：插值、`setLocale` 后同步 watch、缺失 key 回落到 key 本身，4/4 通过。
  - zh/en 各 948 条；没有复数、链接、列表语法；只有 `zh.ts:224` 一条带 HTML（首页用，React 岛不涉及）。
  - React 岛的硬编码中文只有 1 处，已在 `45895f5` 改成 key。
- **后续**：方案 B（`useT()` 用 `useSyncExternalStore` 订阅 `i18n.global.locale`）可选，现在没有必要做。附件的 3 处中文提示见 §14.6。

### 15.5 deploy 仓需要的改动点（本单不改 deploy 仓）

本仓的入口脚本已经支持 `CHAT_UI_DEFAULT`（`docker-entrypoint.d/40-runtime-config.sh:76-81`）。它**不在** `runtime_keys`（`:45`）的循环里，而是单独 `case`：
- 未设置或空串时不写入。
- `old|react` 写入 `"CHAT_UI_DEFAULT":"…"`。
- 其它值会让容器启动失败（exit 1）。

所以 deploy 侧只需要按环境设一个**环境变量** `CHAT_UI_DEFAULT`。读 `../nucleagent-deploy`（HEAD `3437c24`）的结果：

| 文件:行 | 现状 | 需要的改动 |
|---|---|---|
| `tools/env-modify/runner-cw.cjs:37` `CFG.batch` | core-web 按环境写入的键表：5（预发）= `CORE_UPSTREAM, SHELL_ORIGIN, VITE_AUTH_BACKEND_URL, VITE_CORE_BACKEND_URL, VITE_CORE_WEB_URL, VITE_EMBED_HOST_ORIGINS, VITE_SHELL_URL, VITE_STORAGE_URL`；8（生产）= 后 6 个 | 需要按环境切换时，往对应环境的数组加 `'CHAT_UI_DEFAULT'`（值 `old` 或 `react`）。只想保持旧视图的环境**不用加**（缺省就是旧视图） |
| `tools/env-modify/runner-cw.cjs:47` `CFG.unwritten` | 部署时不写入的键 | 如果某个环境暂不下发，也可以记在这里 |
| `tools/env-modify/accept-shape-cw.cjs:30` `BATCH` | 回读校验用的键表，和上面的 batch 镜像一致 | 和 `runner-cw.cjs:37` 同步加 `'CHAT_UI_DEFAULT'` |
| `tools/env-modify/runner-cw.test.cjs:226-228` `STAGE5 / STAGE_PRE` | 测试里的同一份键表 | 同步更新，断言里的 `keys=[…]` 列表（如 `:452,:458`）也要一起改 |

deploy 仓的 `.env.example`、`docker-compose.yml`、`scripts/dev.sh` 不涉及 core-web 的 runtime-config 键表，本地开发不设这个变量即可。TEST 环境（不在 5/8 里）的下发通道没有在 deploy 仓里找到，按现有 TEST 的配置方式手工加环境变量。上面这些都只是读出来的结果，**没有改 deploy 仓**。
