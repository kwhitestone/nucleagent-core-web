> 第 3 棒独立核实报告原文（2026-11-13，基线 `64152ff`）；机器私有路径已删。要点与之后的变化见 `muyu365-react-chat-rewrite.md` §15。

# MUYU-365 核实报告（4 项）

- 基线：detached `64152ff`，对比 `c0a82a7`；Node v24.14.0 / npm 11.9.0；日期 2026-11-13
- 只读：未改 src/、package.json、package-lock.json、docs/；`git status` 仅本报告与两个既有未跟踪文件。`npm ci --ignore-scripts` 未改 lock。
- 临时脚本（lic.mjs、attr.mjs、closure.mjs、i18n 测试、带 sourcemap 的构建）都在机器临时目录，未入库。

---

## 1. 许可证全树 —— 达标（无 copyleft 进生产包）

**方法（两法互证）**
- 自写临时脚本 lic.mjs：遍历 package-lock 中非 dev 条目（184 个），逐个读 `node_modules/<pkg>/package.json` 的 license，与 lock 字段比对（仅 1 处不一致，见下）。
- `npx license-checker@25 --production`（联网可用）。
- `npm ls --omit=dev --all --parseable` 比 lock 多出 3 个：`@types/react`、`@types/react-dom`、`typescript`。这 3 个是生产包的 peerOptional，只在 dev 安装，不进打包产物。

**汇总（lock 的生产闭包，184 个）**

| 许可证 | 包数 |
|---|---|
| MIT | 173 |
| BSD-3-Clause | 3 |
| ISC | 2 |
| BSD-2-Clause | 2 |
| 0BSD | 1 |
| Python-2.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| 无 license 字段 | 1 |

license-checker 结果：MIT 174 / BSD-3 3 / ISC 2 / BSD-2 2 / 0BSD 1 / Python-2.0 1 / (MPL-2.0 OR Apache-2.0) 1 / Apache-2.0 1（typescript）/ UNLICENSED 2（根项目 + editor-ui）。和上表的差别只来自根项目本身和 peerOptional 的 TS 包，结论一致。

**非 MIT/ISC/BSD/Apache/0BSD 的包，逐个读了原文**

| 包 | 字段 | 原文判断 | 结论 |
|---|---|---|---|
| `argparse@2.0.1`（markdown-it → argparse） | Python-2.0 | `node_modules/argparse/LICENSE` 是 PSF License 全文（"A. HISTORY OF THE SOFTWARE…"），宽松许可，非 copyleft | 可用。只给 markdown-it 的 CLI 用，浏览器包不引用 |
| `dompurify@3.4.15` | (MPL-2.0 OR Apache-2.0) | 有 `LICENSE`（Apache 2.0 正文）和 `LICENSE-MPL` 两份，二选一 | 选 Apache-2.0，无 copyleft 义务 |
| `@prism-fusion/editor-ui@0.1.0` | 无字段（license-checker 记为 UNLICENSED） | 来源是 `vendor/editor-ui-…tgz`，有 provenance（sourceCommit 1f36a5cd…），包里没有 LICENSE 文件 | 自家 vendor 包，**需确认归属/授权**；与 MUYU-365 无关（c0a82a7 已存在） |

生产闭包中**没有** GPL/AGPL/LGPL/CC/SEE LICENSE。

**重点包**：react 19.3.1、react-dom 19.3.1、@assistant-ui/react 0.15.36、core 0.3.35、store 0.3.23、tap 0.9.25、assistant-stream 0.3.57、assistant-cloud 0.2.11、safe-content-frame 0.0.34、radix-ui 1.8.1 均为 MIT，并且都带 LICENSE 文件。

**相对 c0a82a7 新增的生产包（`git show c0a82a7:package-lock.json` 逐键 diff）**：92 个。其中 90 个 MIT，例外是 `secure-json-parse@4.1.1` BSD-3-Clause、`tslib@2.9.1` 0BSD。主要组成：@assistant-ui/* 4 个、assistant-stream/assistant-cloud（各带一个嵌套 nanoid 6.0.2）、radix-ui 加约 60 个 @radix-ui/*、react/react-dom/scheduler、react-remove-scroll 系、use-* 小 hook、zustand、@floating-ui/react-dom、@standard-schema/spec、@types/json-schema、@babel/runtime 等。
- 新增的 dev 包里唯一非宽松许可是 `caniuse-lite` CC-BY-4.0，只在构建期使用，不随产物分发。
- 升级：zod 4.6.5→4.6.7；@babel/parser、@babel/types、@babel/helper-string-parser 为 dev。

**后续**：editor-ui 的 tgz 补一个 LICENSE 或 `"license"` 字段（内部包写 `UNLICENSED`/专有即可）。可以在 CI 加 `npx license-checker --production --failOn 'GPL;AGPL;LGPL;CC-BY-SA'`。

---

## 2. React 分包真实体积 —— 不达标（gzip 超 2.3 KiB），brotli 达标

**复现 §13.3**：`npm run build`（vue-tsc + vite，exit 0）→ `node scripts/muyu365-bundle-size.mjs dist`

```
all JS 585.54 KB | default entry 159.47 | /chat 203.41 | /c/:id 279.49 | default chat routes 297.36
React island extra 182.33 KB (ChatHost-4EcZPm5n.js, mount-CiAKCgAW.js)
```
与 §13.3 完全一致。

**gzip / brotli（临时脚本 closure.mjs，单位 KiB）**

| 范围 | gzip | brotli |
|---|---|---|
| ChatHost + mount（React 独占） | **182.33** | **154.49** |
| 打开开关后 React 路由完整闭包（含入口） | 411.40 | 350.45 |
| 默认 Vue `/c/:id` 闭包 | 279.49 | 240.44 |
| React 闭包减去 Vue `/c/:id` 闭包 | 182.33 | 154.49 |

React 路由用到的其余分包（useConversation、modelPickerOptions 等）全部与 Vue 共用，所以 React 独占的只有上面两个文件。`mount` 单独 gzip 186 039 B / brotli 157 705 B；ChatHost 734 B / 668 B。
nginx.conf.template 里没有 grep 到 gzip/brotli 配置，线上实际按哪种压缩传输未核实。

**大头来源**：另做了一次带 sourcemap 的构建（独占体积 182.40 KiB，与正式构建差 0.07），用临时脚本 attr.mjs 解码 VLQ，把生成的字节按源模块归属。下表 gzip 列 = 该模块原始字节占比 × 分包 gzip 总量（估算）。

| 来源 | raw B | ≈gzip KB |
|---|---|---|
| @assistant-ui/core | 222 453 | 67.0 |
| react-dom | 210 133 | 63.3 |
| @assistant-ui/react | 64 133 | 19.3 |
| assistant-stream（aui 传递依赖） | 37 797 | 11.4 |
| @assistant-ui/store | 27 200 | 8.2 |
| @assistant-ui/tap | 21 242 | 6.4 |
| react + scheduler | 12 338 | 3.7 |
| src/chat-react/ChatApp.tsx | 4 655 | 1.4 |
| react-textarea-autosize + @radix-ui/react-slot + secure-json-parse | ~7 900 | 2.4 |

合计：assistant-ui 全家约 112 KB（约 61%），React 运行时约 67 KB（约 37%）。

- **markdown / zod / vue 共享部分在 React 独占包里为 0**。markdown-it（≈20.7 KB）、entities（13.2）、dompurify（11.9）、linkify-it（3.8）在 `useConversation-*.js`，与 Vue 共用；zod（≈32.6 KB）、vue-i18n 与 en/zh 文案在 `main`；vue / vue-router 在 `index`。打开开关后这些都不增加体积。
- aui 内部较大的块：runtime/base ≈12.0、composer primitives ≈9.8（其中 `composer/trigger` ≈5.9）、external-store ≈9.7、voice-session ≈2.4、ToolInvocationTracker ≈3.1。所有 aui 包都已是 `sideEffects:false`，tree-shaking 已经生效，剩下的都是 runtime 实际引用到的。

**可裁剪点（估算，未实测）**
1. 不用 `ComposerPrimitive.Input`，改成自家 `<textarea>` + `useAui().composer.setText/send`。`ComposerInput.js` 引入了 `react-textarea-autosize`、`radix-ui`、`useComposerInputState.js`（trigger popover）（`node_modules/@assistant-ui/react/dist/primitives/composer/ComposerInput.js:10-17`），预计可省约 6–8 KB gzip。这一项足以压到 180 KiB 以内，但需要实测确认 trigger 只被它引用。
2. `ComposerPrimitive.Root` 换成 `<form>` + `useComposerSend`，约 0.5–1 KB。
3. assistant-stream、voice-session、ToolInvocationTracker 是 core 运行时内部静态引用，应用侧的 import 路径裁不掉。
4. react-dom（≈63 KB）只能靠换成 preact/compat 之类的方案去掉，风险大，不建议。

**后续**：U5 如果按 brotli 计（154.5 KiB）已经达标；按 gzip 计先做第 1 项再复测。`/c/:id` 默认路径 +1318 B 超 1 KiB 的问题本次未处理，§13.3 已记录。

---

## 3. 单条可替换排队 —— 需自写（aui 提供管道，但自带的 `createMessageQueue` 不是单槽语义）

**源码事实**（`node_modules/@assistant-ui/core/src/…`，`@assistant-ui/react` 已重新导出）
- 开启方式：`ExternalStoreAdapter.queue?: ExternalThreadQueueAdapter`（`runtimes/external-store/external-store-adapter.ts:202-203`）。传入后 `capabilities.queue = true`（`external-store-thread-runtime-core.ts:588`）。
- 运行中发送是否被禁用：
  - `composerSendDisabled = isDisabled || !canSend || (isRunning && !capabilities.queue && !voice)`（`store/primitive-predicates.ts:13-18`）。
  - 回车同理：`ComposerInput.tsx:278-284`（react/src/primitives/composer）。
  - 结论：**不传 queue 时，运行中 Send 被禁用；传了 queue 就可以发**。
- 运行中的消息去向：`append` 有 queue 时不调用 `onNew`，而是 `message.steer ?? isRunning ? queue.steer(message) : queue.enqueue(message)`（`external-store-thread-runtime-core.ts:1180-1207`，判断在 1204-1206）。**运行中默认走 steer 车道，而不是 enqueue。**
- 适配器接口：`items / steerItems / enqueue / steer / move / edit / remove`（`runtime/queue/external-thread-queue-adapter.ts:14-29`）。另有 `__internal_notifyCancelled`，在取消时调用（`external-store-thread-runtime-core.ts:1541,1580`）。
- `createMessageQueue(driver)`（`runtime/queue/message-queue.ts:123`）：
  - `push` 是追加，多条 FIFO（`:321-330`），**没有“只保留 1 条/替换”**。
  - `steer()` 在运行中且 driver 提供 `cancel` 时，会**取消当前运行再插队发送**（`:336-345`，`interrupt` 在 `:265-319`）；不提供 `cancel` 时退化为“下一条处理”。
  - `edit(id, msg)` 可以替换某一条的内容（`:426-436`）。
- 宿主责任：ExternalStore runtime **不会**替宿主调用 `notifyBusy/notifyIdle`，只有 LocalRuntime 会（`runtimes/local/local-thread-runtime-core.ts:929,938`）。用 `createMessageQueue` 时，宿主要在 isRunning 的上升/下降沿自己调用。
- 渲染：`ComposerPrimitive.Queue`、`QueueItemPrimitive.Text/Remove/Steer`（react/dist/index.d.ts:79）。
- 现状：`src/chat-react/externalStore.ts:19-35` 没有传 queue；`ChatApp.tsx:77-82` 运行中只显示 Cancel，不显示 Send。

**最小自写方案（约 40 行）**
- 位置：`src/chat-react/externalStore.ts` 新增 `useSingleSlotQueue(controller, running)` hook，在 `ChatApp` 里把返回值作为 adapter 的 `queue` 传入。
- 自写 `ExternalThreadQueueAdapter`，内部状态为 `slot: {id, message} | null`：
  - `enqueue(m)` 与 `steer(m)` 都执行“有槽就替换内容（保留 id），无槽就新建”。steer 不中断运行，“停止并发送”交给 Cancel 按钮。
  - `items = slot ? [toItem(slot)] : []`，`steerItems = []`。
  - `edit` 替换内容；`remove` 清槽；`move` 不做任何事。
  - `__internal_notifyCancelled` 置 paused，取消后保留排队内容不自动发送，与 aui 语义一致。
- 冲刷：`useEffect` 监听 `isRunning` 从 true 变 false（即 Core 终态），且未 paused 且槽非空时，调用 `controller.send(appendText(slot.message))` 并清槽。
- 409 兜底：前端认为空闲、后端却返回 409 时，`onNew` 的 catch 里判断 status 409，把消息写回槽，不抛 `MessageNotSentError`；冲刷时如果再次 409，也留在槽中。
- UI：运行中也渲染 `ComposerPrimitive.Send`（去掉 `ChatApp.tsx:77` 的 AuiIf），加上 `<ComposerPrimitive.Queue>` + `QueueItemPrimitive.Text/Remove` 显示“待发送 1 条”。
- 测试：用 node --test 测纯函数槽（替换、清槽、取消后不冲刷、409 回槽）。

**后续**：325 §B.6 只要求“只排 1 条、可替换”，按上述方案自写即可。不要直接用 `createMessageQueue`：它的多条 FIFO 不满足要求，而且在传 `cancel` 时，运行中发送会打断当前任务。

---

## 4. i18n 共用 —— 支持（已实测）

**现状**
- `ChatHost.vue:16-32` 用 `useI18n()` 的 `t` 包装成 `props.t` 传给 React，并 `watch(locale)` 触发 `island.update()` 重渲染。文案已经共用同一份 zh/en，`chatReact.*` 在 `zh.ts:195-202`。
- React 岛的硬编码中文：**1 处**，`src/chat-react/ChatApp.tsx:32` 的 `"消息格式异常，已跳过一条更新"`。其余 `.ts/.tsx/.css` 都是 0 处。

**无组件上下文验证**（临时 i18n.test.mjs）
- 方法：用 esbuild 把 `src/i18n/index.ts` 打成 ESM，stub 掉 localStorage/navigator/document，然后 `node --test`。**4/4 通过**：
  1. `i18n.global.t("chatReact.stop") === "停止"`；命名插值 `t("model.typeMismatch", {model, type})` 输出正确。
  2. `setLocale("en")` 后，`watch(i18n.global.locale, …, {flush:"sync"})` 立即收到 `"en"`，t 的返回随之改变，`document.documentElement.lang` 同步更新。
  3. 缺失 key 返回 key 本身，与 Vue 侧行为一致。
  4. `i18n.global.getLocaleMessage("zh")` 可以当纯数据读取。

**语法兼容**
- zh/en 各 948 条字符串，其中命名插值 `{x}` 88 条。没有复数 `|`、链接 `@:`、列表 `{0}`、字面量 `{'…'}`。
- 只有一条含 HTML：`zh.ts:224`（`<em>`，首页用，React 岛不涉及）。
- React 侧直接调用 `i18n.global.t(key, named)` 即可，不需要转换。

**推荐方案（二选一）**
- A（现状，最省事）：保持由 ChatHost 注入 `t`，locale 变化由 Vue `watch` 触发 `root.render`。
- B（React 自给）：在 `src/chat-react/` 加一个 `useT()`：`useSyncExternalStore(sub, () => i18n.global.locale.value)`，其中 `sub` 用 `vue` 的 `watch(i18n.global.locale, cb)` 注册，返回 `i18n.global.t`。这样可以去掉 props.t 的透传，且不增加 React 分包体积（i18n 在 `main`）。
- 两种方案都要把 `ChatApp.tsx:32` 的中文换成新 key，例如 `chatReact.badUpdate`，zh/en 都补上。

