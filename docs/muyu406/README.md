# MUYU-406 交接：模型 Controls、逐轮用量、体积

最后更新 2026-11-16。分支 `feat/gap-selector-muyu406`，从 gap2 `782607e` 起的线性链，最后一个代码提交 `972ae229cacfa4e3c3aa614534061061060940d8`（其后只有本文档的提交）。

**状态：未发布。** 远端最新 tag `v0.1.5`（`946d158`）不含 gap2 也不含本分支任何提交；`main` = `c0a82a7`，`master` = `37deaf7`。TEST/PRE/PROD 验收全部 NOT_RUN。

**逐轮积分线上未接通。** 每条回答显示“积分：—”。前端已留好接入点，后端没有可读的逐轮结算接口（第 3 节）。

## 1. 本分支做了什么

| 提交 | 内容 |
|---|---|
| `04f3db6b7d338263e4c3cd118254d44eeb04be01` | 有 effort 证据才发送 effort 覆盖 |
| `5e419fcc60c9f89f75d4f7fe72f99b87315488a6` | effort 证据按 executor 限定；思考回放校验 |
| `07eafbe1d5185ec084f7058e72abb48c649627f5` | 模型 Controls 菜单；逐轮用量显示边界 |
| `ef5f5301fc32b1c6d9b0f1cabc1ae5919381c380` | pending 结算态；`Composer` 的 `controls` 插槽 |
| `f1af9a3493b2b848f6e18f7bb5dd65302c43d1e9` | 用量绑定 Core `step_id`；`settlementReader` 接入点 |
| `972ae229cacfa4e3c3aa614534061061060940d8` | 模型菜单与 Controls 共用 `useMenu`，回收体积 |

代码位置（都在 `src/chat-react/`）：

| 文件 | 职责 |
|---|---|
| `ModelControls.tsx` | 唯一 Controls 入口与面板；`useMenu`（两个菜单共用的开合、聚焦、外点关闭、方向键巡航） |
| `requestEffort.ts` | effort 默认值、按模型记忆、`effortView`（能不能选）、`sentEffort`（实际发送值） |
| `chatStrategy.ts` | 读 `chat-strategy.json` 的逐 provider+model+backend effort 证据 |
| `turnUsage.ts` | `turnUsage()` 视图规则、`SettlementReader` 类型、`settlementRows()` 校验 |
| `TurnUsage.tsx` | 每条回答下的用量显示 |
| `threadMessages.ts` | assistant 消息的 `metadata.custom.turnId` = 主执行行的 `step_id` |
| `ChatApp.tsx` | `useSettlement()`、`ChatProps.settlementReader?`、`Composer` 的 `controls?` |

测试：`tests/chatReactUi.test.ts`、`tests/turnUsage.test.ts`、`tests/requestEffort.test.ts`、`tests/chatStrategy.test.ts`、`tests/chatReactAdapter.test.ts`。

## 2. Controls 唯一归属与 408 冲突

**唯一 Controls 组件是本分支的 `ModelControls`**（模型选择器旁的旋钮图标，`role=menu` 面板）。其他单的内容只能做它的插槽内容。

### 2.1 插槽合同

| 项 | 合同 |
|---|---|
| 入口 | 只有 `ModelControls`。不得再加第二个 Controls 按钮、aside 或菜单 |
| 插槽 | `ModelControls` 的 `children`；从外面进来只走 `<Composer controls={…} />`，渲染在同一面板里，排在 effort 单选之后 |
| 插槽内可交互项 | `<button type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item" aria-checked=…>`。自动并入方向键/Home/End 巡航、Escape 关闭回焦，点击不关面板 |
| 被巡航跳过的项 | `disabled` 的按钮，以及 `aria-disabled="true"` 的项（后者自 `972ae22` 起） |
| Tab | 关闭面板并回焦图标。插槽里放多个原生 `<select>` 不能用 Tab 互相切换，应改成单选项 |
| 挂载时机 | 面板关闭时插槽内容仍然挂载（只是 `hidden`）。挂载即请求的组件会在输入框出现时就请求 |
| CSS | `.mc-controls`、`.mc-controls .mc-menu` 归本分支。插槽内容用 `.mc-menu-label`、`.mc-menu-item`、`.mc-menu-text` |
| 文案 | 走 `islandStringsZh/En` 的 `chatReact.*` 键 |
| effort 控件 | 只保留面板里的 默认/低/中/高 |
| effort 字段 | 选了 profile：发 `profileId` + `modelParams.reasoningEffort`（值取 `effort.sent`，空则不带），不发旧 `reasoningEffort`。没选 profile：维持 `withRequestEffort` 发旧字段。两者不可同发 |
| 能力来源 | 档位能不能选 = `effortView`（证据文件）；选了 profile 时再与服务端 profile 白名单取交集 |

### 2.2 与 408（`feat/gap-profile-admin`）的冲突

只读核对本地引用 `fa3b94e`（该分支不在远端，`ls-remote` 无此 ref）。它基于 `3a69082`，不含 gap2，仍是旧形态：

| 冲突点 | 408 现状 | 原样合并的后果 |
|---|---|---|
| 入口 | `ChatApp.tsx` 里 `mc-controls-toggle` 按钮 + `controlsOpen` 状态 + `<aside class="mc-controls">` | 同屏两个 Controls 入口 |
| CSS | `chat.css` 定义了 `.mc-controls { position:absolute; right:0; top:60px; … }` | 规则套到本分支图标容器上，图标错位并带边框 |
| effort | 自带“推理强度” select | 两处可选；profile 字段与旧 `reasoningEffort` 同发会被 408 的 Core 拒绝（400） |
| 同一行改动 | `useCoreConversation` 第三参数、`mc-root` 顶部 | 合并必冲突，按 2.1 的 effort 字段规则解 |

408 适配清单（本单不代做）：
1. 删 `mc-controls-toggle` 按钮与 `controlsOpen`。
2. `ProfileControls` 去掉 `<aside>`、标题、`<details>` 外壳和 effort select，只返回 profile 单选项与说明文字。
3. 交给 `<Composer controls={…} />`。
4. 删自己的 `.mc-controls*`、`.mc-controls-toggle`、`.mc-root { position: relative }`；文案进 island strings。
5. 在组合候选上重测体积。

**协作状态：未确认。** 没有证据表明 408 已读到这份合同；它的分支头仍是旧形态。

## 3. 逐轮结算：前端合同与后端缺口

### 3.1 前端已实现（有测试，线上无数据源）

- 轮次身份只来自 Core 消息的 `metadata.step_id`。消息 ID 不是轮次。子 agent 行不参与。没有 `step_id` 或主执行行出现两个不同 step 的回答没有身份，显示“—”。
- 显示规则（`turnUsage()`）：

| 证据 | 显示 |
|---|---|
| 没有证据、身份缺失、跨会话/跨轮、同 revision 重复、revision 非法 | 积分：—（unknown） |
| 最新 revision 是 pending | 积分：— · 待结算，不带金额和上游 |
| 最新 revision 是 settled，`points` 是十进制字符串，上游非空 | 积分：数值 · 上游 |
| 同上且 `points` 为 `"0"` | 积分：0（真实 0） |
| pending/unknown 即使带 `points: "0"` | 积分：— |

- 迟到回执：更高 revision 的 settled 覆盖 pending；更高 revision 的 unknown 把它退回未知。
- Reader（`useSettlement`）：不传就不发请求；会话、reader 或运行状态变化时重读；新读取 abort 旧读取，晚到的旧结果丢弃；读取失败或任何一行不合形状，整次作废并清掉已显示的数值。
- 宿主 `ChatHost.vue` 没有传 reader，**生产路径零调用**。
- 已知限制：运行结束之后才到的回执，要刷新页面才显示。轮询还是推送等真实投影定了再选。

### 3.2 后端缺口（未落地，路径与 DTO 不存在）

以下是此前只读核对 Core 与 Toolgate 已 fetch 引用的结论，本次没有复核：

1. **没有逐轮关联。** 铸 key 只带 `conversationId`；Core 把 Toolgate 返回的 `keyId` 丢弃，没有任何地方存 step ↔ key。
2. **Core 读不到账本。** Toolgate 没有 S2S 账本读接口。浏览器直连 `GET /api/v1/usage/details` 需要 Toolgate 会话和 origin 白名单，且只到会话粒度。
3. **明细行没有逐行积分。** 积分是展示换算，只有余额/钱包接口给总数；前端不能自己换算。

要补的（归 Core 与 Toolgate owner）：
- Core：保留 `keyId` 并与当时的 `step_id` 一起落库（一轮可有多把 key）；新增按会话 owner 校验的只读投影，按 `stepId` 分组，每组给 `stepId`、`state: pending|settled|unknown`、`points`（仅 settled，十进制字符串）、`upstreams[]`、`revision`（单调递增）。
- Toolgate：给 Core 一条账本读路径并附逐行积分或换算率。
- 陷阱：经济结算会把行的 `deducted_quota` 置 0，真实扣费在 `economy.total_deducted`，不能把 0 当真实 0。

接通时前端只做一件事：写一个 `SettlementReader`，把真实投影映射成 `SettlementEvidence`（`turnId` = `stepId`），在 `ChatHost.vue` 传给 `settlementReader`。

## 4. 体积

门禁：`node scripts/muyu365-bundle-size.mjs dist <基线dist>`。React 岛 JS ≤ 180 KiB（gzip），默认路径各项对基线增量 ≤ 1024 B。

口径：React 岛 = `ChatHost`、`mount`、两个 `islandStrings` chunk 的静态闭包，**加上其中每个 `import()` 目标的闭包**，减去默认 Vue 路径已加载的文件，逐文件 gzip 求和。所以把代码挪进 lazy chunk 不会让它离开这个数。

| 提交 | React 岛 JS | 余量 |
|---|---|---|
| gap2 `782607e`（基线） | 178.58 KiB | — |
| `07eafbe` | 179.27 KiB | — |
| `ef5f530` | 179.29 KiB | — |
| `f1af9a3` | 179.92 KiB（184237 B） | 83 B |
| `972ae22` | **179.76 KiB（184073 B）** | **247 B** |

- `972ae22` 回收 164 B：模型菜单和 Controls 各有一份开合/聚焦/外点/巡航代码，合成一个 `useMenu`。
- 按需加载试过，没有收益：把 `TurnUsage.tsx` 放到 `React.lazy` 后，岛 JS 变成 184713 B（180.38 KiB），比不拆多 640 B，门禁 FAIL。原因是组件本身只有约 500 B，新 chunk 的固定开销加 `lazy`/`Suspense` 胶水更大，而门禁照样把 lazy chunk 计入。没有提交。
- 上限：本分支相对 gap2 的全部增量约 1.18 KiB。即使继续压，能回收的也到不了这个数。
- **与 408 的组合仍然放不下。** 408 在自己基线上的增量此前实测约 1.71 KiB，本分支只剩 247 B。组合体积必须在组合候选上实测，超出部分由 408 按 2.2 收缩（删重复入口、CSS、effort select），不放宽门禁。

## 5. 给 365 的集成顺序

365 是唯一发布写者。

1. 候选须已含 gap2：`git merge-base --is-ancestor 782607e6ead3140186f361bfcfc5b1fe7087e100 <候选>`。
2. 按序取本分支六个提交：`04f3db6` → `5e419fc` → `07eafbe` → `ef5f530` → `f1af9a3` → `972ae22`（完整 SHA 见第 1 节）。
3. 作者：前三个提交作者是 `Codex <codex@localhost>`，主干至今没有这个作者。整合时 `git cherry-pick -x` 后重置作者，或整批 squash；不要 force 已推分支。
4. 408 core-web 不能原样叠加，先按 2.2 适配或在合并时按 2.1 解冲突。
5. 408 的 Core/executor 改动、Core 目录 `upstream` 字段透传、TEST 环境思考可见性开关：沿用此前交接，本次未复核。
6. 逐轮积分后端差量（3.2）是独立后续批次，不挡本批；没有它时界面如实显示“积分：—”。
7. 组合验证：`npm run test:unit`、`npm run build`、体积脚本对基线 dist。
8. 发布：TEST → 真实域名验收（图标/面板/键盘/移动端、effort 禁用态、每轮“—”、408 profile 在同一面板内）→ PRE → PROD。

## 6. 剩余阻断

| 阻断 | 归属 | 恢复条件 |
|---|---|---|
| 逐轮积分未接通 | Core / Toolgate owner | 3.2 落地并给出真实路径和 DTO，之后前端接 reader |
| 组合体积放不下 | 365 与 408 | 408 收缩后在组合候选实测通过 |
| 408 合同未确认消费 | 协调者 | 408 回报按 2.2 适配后的新 SHA |
| 未发布、未验收 | 365 | 正式发布后逐环境验收 |

本分支的测试都是本地 jsdom/SSR fixture，reader 是测试里的假实现，不证明线上行为。没有真实浏览器验收，没有截图。仓内没有 lint 脚本，未跑 lint。
