# MUYU-365 整体UI重设计规格（OpenWebUI 参考体系，v84）

日期 2026-11-20。参考基准按用户最新改口：**OpenWebUI**（不再参考 Gemini）。本规格是 Web35/36 已对齐 OWUI 后的同体系整体升级，不推倒。品牌保持 NucleAgent，不使用 OpenWebUI 商标、Logo 或文案。

- 设计稿（单文件可运行）：`exp84/design/design-draft.html`（sha256 见 REPORT），右下角“状态”可切 终态/过程展开/流式/50次调用/首页/附件上传中；`?s=<state>&shot` 隐藏切换器。
- 真实截图：`exp84/design/shots/design-{1440,390,320}-{done,open,stream,fifty,home,attach}.png`，由本任务自有业务浏览器（biz-browser 9489）实际打开截图；18 张横向溢出均为 0（`shots.json`）。
- 原图核对：`exp84/IMAGE-ACK.md`（img_a8fa6b437d4c，sha256 一致，原生看图）。

## 1. 参考来源（固定版本，可复核）

OpenWebUI **v0.13.3，commit `b0e6098e940942281d9c83f3529ea117287a3a22`**。文件在 `exp84/upstream/`（附 SHA256SUMS、FETCHED_AT=2026-11-20），其中 UserMessage/Messages/Message/app.css 本次匿名 raw 固定 SHA 取得；其余沿用 exp80/exp81 已核文件。

| 设计点 | OWUI 源码事实（文件:行） | 本设计采用 |
|---|---|---|
| 内容列宽 | `Message.svelte:68-70` 非宽屏 `max-w-[58rem]`、`px-3.5`；`MessageInput.svelte:1986-1987,2039-2040` 输入区同 `max-w-[58rem]` | 消息/过程/输入框同一列 **48rem(768px)**——NucleAgent 中文正文行长更短更易读，取 OWUI“同列同宽”原则而非照搬数值 |
| 正文字号 | `ResponseMessage.svelte:955` `text-[0.90625rem] leading-relaxed` | 正文 14.5px / 1.7 |
| 用户消息 | `UserMessage.svelte:443-444` `rounded-3xl max-w-[90%] px-4 py-1.5 bg-gray-50` | 浅灰圆角气泡 24px，替换蓝色渐变；去掉“你”徽章（截图 P3） |
| 输入框 | `MessageInput.svelte:2232-2236` `shadow-lg rounded-3xl border border-gray-100/50`、hover/focus 边线加深 | 24px 圆角、浅边 + 柔和 shadow-lg，focus 仅边线加深（去掉 4px 光晕） |
| 操作条 | `ResponseMessage.svelte:1110-1135` `size-7 … rounded-lg`，`isLastMessage ? 'visible' : 'hover-reveal'` | 沿用 32px 图标按钮（触控目标，已有测试锁定，比 OWUI size-7 略大）；最后一条常显，其余悬停/聚焦显示；触屏常显 |
| 时间戳 | `ResponseMessage.svelte:992` `text-[0.6875rem] tabular-nums text-gray-400` | 11px 等宽数字，悬停显示 |
| 过程分组 | `ConsecutiveDetailsGroup.svelte:209-265` 单行摘要 `line-clamp-1` + 工具数；`:338` `slide 300ms quintOut` | “执行过程”无卡片单行摘要：`执行过程 · N 次调用 · 最近工具 · 首字 X 秒`；展开 240ms ease-out |
| 活动状态 | `app.css:219-258` `.shimmer` 1.5s；`ConsecutiveDetailsGroup.svelte:257-261` 活动时文字 shimmer | 唯一活动行文字 shimmer + 小圆点脉冲（沿用 Web36 单一活动） |
| 工具详情 | `ToolCallDisplay.svelte:315-323` 展开后 `rounded-2xl border p-2.5` | 单条调用记录展开为细边浅底等宽块，单条限高 160px |
| 状态历史 | `StatusHistory.svelte` 默认只显示最新状态，历史可展开 | 默认收起，摘要里给最新工具名 |

未核/差异：OWUI 官方截图——exp80 `upstream/official-demo.png`（README 指向 CDN 动图第150帧）为 CDN 版本，**不冒称等于 b0e6098 版本**；本次未取新官方截图。OWUI 的错误聚合红色图标 **不采用**（Web36 用户已否决，中间失败中性呈现）。Gemini 来源不再使用。

## 2. Tokens

| 类别 | Token | 值 |
|---|---|---|
| 字体 | `--font-sans` | Inter, PingFang SC, Microsoft YaHei, Noto Sans SC, system-ui（沿用 aurora 变量，不新增字体文件） |
| | `--font-mono` | ui-monospace, SFMono-Regular, Menlo, Consolas |
| 字号 | body / meta / micro | 14.5 / 12 / 11 px；窄屏 body 15px（防 iOS 缩放并提可读） |
| 行高 | body | 1.7 |
| 列宽 | `--mc-col` | 48rem |
| 间距 | s1..s5 | 4 / 8 / 12 / 16 / 24 px；消息间 24px；窄屏边距 12px，宽屏 20px |
| 圆角 | sm/md/lg/xl | 8 / 12 / 16 / 24 px |
| 颜色 | 均映射现有 aurora 变量 | 页底 `--bg-page`；浅底 `--bg-fill`；线 `--border-divider`/`--border`；字 `--fg-primary/secondary/tertiary`；品牌 `--fg-brand`。不新增硬编码主题色，暗色随 aurora |
| 阴影 | composer | `0 10px 15px -3px rgb(15 23 42/8%), 0 4px 6px -4px rgb(15 23 42/6%)`（≈ Tailwind shadow-lg） |
| 动效 | fast/base/slide | 120 / 180 / 240 ms；ease `cubic-bezier(.22,1,.36,1)`（≈quintOut） |

## 3. 布局

- **实现落点说明**：设计稿为完整画面；core-web 实现落在 React 岛 `src/chat-react/`（消息/过程/思考/成果/操作条/输入区/首页），外壳顶栏不在本仓。
- **主壳**：顶栏属 nucleagent-web 外壳（不在本仓），本次不改其代码；设计稿给出建议（“成果”并入顶栏、去胶囊边框），实现只在 core-web 岛内收紧。浮动“成果”按钮仍由外壳绘制，岛内保留既有 60px 顶部避让带（外壳按钮 18+36px，已有测试锁定）。
- **消息**：单列 48rem 居中。助手：24px 标识 + 名称 + 悬停时间 + 右侧“原文”图标；正文、过程、成果、操作条从 32px 缩进开始与名称对齐（窄屏 ≤520（沿用既有断点）取消缩进）。用户：右对齐浅灰气泡，“原文/编辑/复制/分叉”放气泡下方悬停显示。
- **过程（执行过程）**：去卡片、去内嵌边框；单行摘要可点；展开后左侧 1px 细线导轨 + 列表，历史区限高 320px 内滚动（原 184px 太矮致截图中“卡片内滚动”拥挤）；每条调用一行：圆点 · 工具名 · 调用记录 · 完整输入输出（管理员）。去掉每条重复“[工具]”胶囊（截图 P1/P4）。TTFT 诊断行保留在展开区顶部。
- **思考过程**：与执行过程同一形态（单行可展开），不再是灰底整行条（截图 P2）。
- **成果/附件**：文件卡 = 图标块 + 名称 + 类型·大小 + 下载图标，12px 圆角细边；图片/视频预览沿用 MediaCard/StoredMediaPreview 限宽 420px。
- **操作条 + 用量**：复制、赞、踩、反馈详情、重新生成同排；积分/上游以 12px 浅字跟在同一行末（窄屏换行）。
- **输入区**：24px 圆角、浅边 + shadow-lg；工具行 左：`+`（上传/工作流）、生成图片、生成视频（去胶囊边框，ghost 按钮）；右：模型名（ghost，粗 500）、模型设置（图标+强度值）、发送（深色圆）。窄屏隐藏“生成图片/视频”文字仅留图标；≤360 隐藏强度值文字。提示行 11px，窄屏隐藏。
- **首页**：标识 + “有什么可以帮你？”26px/600 + 副标题；建议 2 列无边框悬停浅底（窄屏 1 列）。

## 4. 状态

| 状态 | 表现 | 数据来源 / 不变量 |
|---|---|---|
| 流式中 | 名称下一处活动行（工具名或“处理中”）shimmer；发送键变停止 | Web36 `turnActive` + 运行中工具；单一活动 |
| 终态成功 | 无活动行；过程收起显示调用数；操作条常显（最后一条） | 真实 snapshot |
| 最终失败 | 沿用 `data-failed` 错误气泡，文字清楚说明 | 不洗绿 |
| 中间调用失败 | 中性圆点，不红不计数；展开调用记录可见原文 | 后台 isError/core.status 不改 |
| 1 / 50 调用 | 摘要数字；展开限高 320 内滚，`overscroll-behavior: contain` | 不删记录 |
| 思考 | 仅授权思考正文出现；默认收起 | 不伪造 |
| 附件上传中 | chip 内进度% ；失败红字 | 现有 aui attachment status |
| 非管理员 | 无“完整输入输出”入口 | 服务端权限不变 |
| 用量 | `积分: N · 上游: X`，待结算显示“待结算” | 结算读回自动刷新不变 |

## 5. 动效（仅以下五类）

| 场景 | 动效 | 时长 |
|---|---|---|
| 发送 | 新消息 `rise`（opacity 0→1, translateY 6→0）；发送键按下 scale .92 | 180ms |
| 流式活动 | 活动文字 shimmer 1.5s 循环 + 6px 圆点脉冲 | 循环 |
| 展开收起 | 箭头旋转 120ms；内容 grid-rows 0fr→1fr | 240ms |
| 菜单 | `pop`（opacity + translateY 4 + scale .98） | 120ms |
| 附件/成果入场 | chip / 文件卡 `rise` | 180ms |

约束：不使用 scroll-behavior:smooth、不在流式时自动滚动动画；展开只改变被点项下方高度，不抢滚（ScrollViewport 跟随逻辑不变）。`prefers-reduced-motion: reduce` 下全部 animation/transition 关闭，shimmer 回退为静态次要色。全部交互保留原生 button/details、aria-expanded、Esc 关闭菜单、焦点环 2px。

## 6. 门禁与实现边界

- React JS ≤180KiB（Web36 179.80KiB）：本次以 CSS 为主，TSX 仅调整类名/结构，**JS 净增目标 ≤0**；默认路由增量 ≤1KiB。
- 不改：Core→executor→原生 CLI、模型身份与 effort/profile 请求、owner 音频/图片 picker、受控图片映射、成果下载、点赞/分叉/历史、owner/admin 权限、积分自动刷新、流式滚动锚定、Web35 菜单与设置文案。
- 不改 muyu-openwebui 颗粒、Agentia、nucleagent-web 外壳。
