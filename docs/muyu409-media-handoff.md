# MUYU-409 媒体首批候选交接（未发布）

本页前半为前序候选历史；最新实现范围以末节“executor 接续增量”和任务根 `REPORT-executor.md` 为准，已包含独立 Core 桥接候选。

## 范围与基线

基于 MUYU-365 React 已验证基线 `3a69082e17362cbf151367652c9da9f045a68235`，独立 `feat/gap-media`。只修改 React 聊天岛及测试，不修改 Core、executor、共享配置或发布环境。MUYU-365 为唯一整合发布写者。

## 实现

- 目录 `TypedModel.type` 决定聊天/图片/视频分组，执行器来自 Core。缺类型时不从型号或 provider.config 猜类型。旧 Core 无类型目录时不枚举模型，保留默认聊天入口及执行器。
- 选媒体模型或工具栏媒体按钮进入同一输入区模式，保留原聊天模型；切回原聊天模型仅改本地模式。未知模型不可进入媒体模式。运行中锁定选择器。
- 生成未接通时以中文说明禁发；新会话、已有会话、队列发送和消息重发最终均经过发送门禁。不调用旧 `createGeneration`，不把媒体提示词当作聊天请求。
- 参数 fail-closed：当前目录只有 `providerId/model/type/capabilities: string[]`，没有模型级尺寸/时长枚举。提示缺能力数据，不采用 Vue 公共 kind registry 推测所有模型都支持某参数。
- 历史消息仍由 Core snapshot/SSE/reducer 提供 taskId；MediaCard 只调用已有 `GET /api/v1/addons/media/generations/:id`。显示真实排队/提交/生成/保存/完成/失败/未知/取消状态；pending 最多读取20次、间隔3秒，显式刷新可重新读，卸载清理计时器。
- 成功媒体图片可预览、视频可播放，下载先重新 GET 并核对 ID/kind/成功状态/URL 协议。刷新重新签名；票据只在组件内存，不落 localStorage。读取错误、链接过期、错任务、缺结果、危险 URL 均不给成功展示。晚到响应不会覆盖新任务卡片。

## 后端合同缺口（不是本批已实现）

本地核查 `nucleagent-core/app/src/server/addons/media/submit.go:179,185` 直接调用 `Gateway.SubmitVideo/SubmitImage`，不能据此宣称已满足 Core→executor→原生CLI→Toolgate/CS。当前 React 不接该创建路径。需由整合线协调真正 executor 工具/技能调用、任务关联/事件归档及模型能力枚举合同，再接前端真实生成。本批没有新造 capability 字段、endpoint 或假成功任务。

后端补齐前不可删除发送门禁。用户选择媒体模式是本地草稿，不是已创建或持久化的媒体任务。历史恢复依赖已有 Core 消息中的 taskId，不新增前端媒体数据库。

## OpenWebUI 真实源码映射

版本 v0.13.0，SHA `c38885a1a737da4968f157092f304f3b5481d0bf`；本任务目录保存 `owui-src/`、LOCK.txt 与 SHA256SUMS。

| 上游路径/行 | 原交互 | 此候选 |
| --- | --- | --- |
| `src/lib/components/chat/ModelSelector/Selector.svelte:132,205` | 聚焦的下拉选择器、当前模型标识、开合动效 | 沿用 React 菜单、方向键与选中态；按 Toolgate type 分组，目鱼皮肤 |
| `src/lib/components/chat/MessageInput/IntegrationsMenu.svelte:490` | 输入区图片生成开关 | 同输入区媒体模式；视频为 MUYU-284 平台扩展 |
| `src/lib/components/common/Image.svelte:48,68` | 点击图片打开 ImagePreview | 图片打开安全预览链接；本批未移植模态画廊，是明确偏离；视频使用原生 controls |
| `src/lib/components/common/ImagePreview.svelte:97` | 下载及失败反馈 | 重新获取 Core 签名链接并校验；跨域是否直接落盘取决于 CDN Content-Disposition，需 TEST 验证 |
| `src/lib/components/chat/Messages/ResponseMessage/StatusHistory.svelte` | 会话内状态历史 | task GET 真实状态；不构造百分比、不重发未知交易 |

## 验证与整合

```sh
node --test tests/chatReactMedia.test.ts tests/chatReactMediaUi.test.ts tests/chatReactUi.test.ts tests/chatReactAdapter.test.ts tests/chatReactQueue.test.ts tests/chatReactTtft.test.ts tests/mediaRegistry.test.ts tests/generation.test.ts
npm run test:unit
npm run build
node scripts/muyu365-bundle-size.mjs dist /path/to/365-baseline-dist
```

最终 SHA、RED/GREEN、全量覆盖率、build 与 gzip 数值、推送读回均见任务根 `REPORT.md` 与 `evidence/`。单测中的 GET 为受控假响应，不能当真实 TEST/CDN 验收。门禁保持 React JS ≤180 KiB、每条默认路径增量 ≤1 KiB；媒体代码静态包含在 React 岛预算内，没有隐藏到门禁之外。

MUYU-365 在独立整合分支 cherry-pick 本候选提交。冲突高概率在 `ChatApp.tsx` 的 ModelMenu、Composer、useSettings 和两种语言文案；保留其他拆单的标签/profile/思考强度实现，同时保持媒体只读/禁发门禁。不直接覆盖整个文件，不重放365已有提交。合并后重跑上述验证，重新核所有拆单合计体积。

## 发布后真实验收清单（本次全部 NOT_RUN）

1. 按298正式 plan→release 由365发布 TEST，记录中文说明、版本/tag、完整SHA、digest状态、环境回执、回滚基线；本单不发布。
2. TEST真实账号读目录：图片/视频/聊天/执行器分组、键盘选择、移动端、切回聊天；无能力时显示中文禁发，Enter/点击/重发均无媒体创建请求。
3. 使用已有成功图片/视频任务，核对会话刷新后恢复、图片预览、视频播放、下载返回外网CDN+下载token、过期刷新；记录真实截图及网络证据。不新增收费生成。
4. 已有失败/未知/取消记录核对中文错误与停止状态；不得点击重试生成造成重复扣费。
5. executor真实媒体链路和模型级参数合同补齐后，才规划真实生成验收及原单费用核账；本候选不能被标为端到端生成已完成。
6. TEST验收后，365按既定原环境范围推进 PRE/PROD；本任务未发版、未验证生产。
# executor 接续增量（2026-11-16，覆盖下文“工具链缺失”的旧判断）

已找到 MUYU-342 的原生 CLI→Core MCP→AIHub workflow→CS 附件链。新增新会话“生成工作流”表单，复用既有工具目录与 schema 路由；只有返回版本化 invocation capsule 的 workflow 才能提交，参数来自真实 schema，提交经现有 conversation→executor→原生 CLI，不调用旧 media 创建接口。

前端只渲染 string/enum 字段；必填文件参数尚不支持时拒绝，输出类型仍未声明，不将图片/视频模型名称猜成工具。图片/视频模型菜单的原安全提示仍保留；用户可明确选择实际工作流完成这一切片。工作流使用其自身模型，聊天模型仅负责原生执行。

Core 候选在本任务 `backend/nucleagent-core`，详情 `docs/muyu409-native-workflow.md`。新字段为 `toolInvocation:{toolId,revision:string,arguments}`；必须先完成 Core 整合和全部实例更新，再开放前端。普通用户的 schema 读取权限沿用 `core:tool:read`，未擅自扩大。

已完成本地 handler/fixture、参数防改写、持久化、异步图片归档/附件读回；前端表单 DOM 与全量测试、build/体积通过。**真实原生 CLI+供应端调用、TEST 图片、视频生成验收和线上发布均 NOT_RUN**。附件沿用既有文件展示/下载，不冒称新媒体播放器全链已验收。提交失败结果未知时表单锁定，先核账和会话历史，不自动重发。

完整SHA、命令和离线bundle以任务根 `REPORT-executor.md` 为准。前序只读媒体候选的历史说明已保留。

# 媒体模型直选增量（未发布；React 体积门禁未过）

选图片/视频模型后，新会话可直接在输入框发送生成，不需要改走“生成工作流”入口；工作流入口保留为可选能力。

- 模型到工具的绑定来自 Core：工具目录行的 `mediaModel` 等于导入的 Toolgate job 工具 `start_args.model` 字面值；`/api/v1/addons/tool/{id}/schema` 对这类工具返回 `model`、调用方可填的真实参数和版本化 `invocation`。前端不写工具 ID、不猜参数。
- 发送体在原 `toolIds`/`toolInvocation` 字段上带该工具和所选枚举参数，提示词是输入框文本；仍是正常 conversation → executor → 原生 CLI → Core MCP → Toolgate job。
- fail-closed：没有该模型的 ready job 工具、schema 的 `model`/`toolId` 不符、没有字符串 `input` 字段、存在非枚举必填参数时，保持禁发提示。
- 本片未做：已有会话追加媒体生成（仍禁发）；生成结果归档到 CS 并写 `metadata.attachments`（当前结果只是会话内密封链接，刷新恢复与安全下载未交付）。
- 体积：React 岛 180.22 KiB，超过 180 KiB 门禁 0.22 KiB，阈值未改。合入前必须再削减。

完整 SHA、证据与剩余项见任务根 `REPORT-direct-model.md`。
