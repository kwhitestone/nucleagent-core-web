# 中性调用记录与轮次活动

## 用户目标与边界

MUYU-365，2026-11-19。普通中间调用不再重复显示失败计数、失败警报或红底红线。调用原文仍在“调用记录”中按需展开，后台 `isError`、`core.status`、call-id 不变；完整私有工具 IO 仍由原管理员门和服务端权限决定。最终回答/系统错误/安全风险原文保留，不生成额外模型结论。Web35输入区、Workflow、音频选择器和Core→executor→原生CLI不变。

## 来源与明确取舍

完整源码取得并核查于本任务 `exp81/upstream/`，逐文件 SHA256 随交付保存。

| 来源 | 实际核到的状态模式 | 本次取舍 |
|---|---|---|
| OpenWebUI v0.13.3，固定 `b0e6098e940942281d9c83f3529ea117287a3a22`：ResponseMessage、ContentRenderer、StructuredOutputRenderer、StatusHistory/StatusItem、ToolCallDisplay、ConsecutiveDetailsGroup | StatusHistory默认只呈现最新状态，历史可展开；工具有 preparing/executing、pending审批、rejected、failed/incomplete、done；参数/结果按需展开。ConsecutiveDetailsGroup分别计算真实工具数、reasoning数和活动状态；模型正文独立。源码确实也有错误图标和聚合错误，不把它描述为全中性。 | 采用当前状态与内容分离、历史折叠、参数/结果按需查看；用户本次明确否决错误聚合，故不复制错误图标、错误计数，也不复制多处并行活动标记。保留本产品184px历史和160px单条记录上限。 |
| OpenAI官方 openai/codex 固定 `39c29c3bb620f91e84a3bb266bb496dfb697c101`，app-server-protocol 的 TurnStatus.ts、ThreadItem.ts | TurnStatus完整枚举为 completed/interrupted/failed/inProgress；ThreadItem区分 agentMessage/reasoning/commandExecution/fileChange/mcpToolCall 等，调用身份与轮次状态分层。 | 用真实轮次状态驱动一处活动，真实调用单独保留；不把某次失败等同最终失败或把重试改成功。此为原生协议来源，不声称已取得Codex闭源GUI完整视觉状态。官方开发者网页本次403，未核其GUI视觉。 |
| Claude官方工具文档/界面 | 指定support页面404；platform文档返回区域不可用页面，title为 App unavailable in region。未取得完整官方UI状态模式。 | 明确未核，不凭印象模仿，不引用区域拦截页作为工具状态证据。 |

源码地址：

- `https://github.com/open-webui/open-webui/tree/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/chat/Messages`
- `https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/common/ToolCallDisplay.svelte`
- `https://github.com/openai/codex/tree/39c29c3bb620f91e84a3bb266bb496dfb697c101/codex-rs/app-server-protocol/schema/typescript/v2`
- 未取到：`https://developers.openai.com/codex/app-server`、`https://support.claude.com/en/articles/11512350-using-claude-s-extended-thinking`、`https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use`。

## 状态矩阵

| 真实输入 | 活动显示 | 调用/内容 |
|---|---|---|
| 当前轮running且真实工具运行 | 一处工具名及动效 | 每个真实调用独立，原状态不改 |
| 当前轮running，思考或已有正文，无运行工具 | 一处“处理中” | 授权思考默认折叠，标题只写思考过程，不出现等待首个内容 |
| 中间失败后恢复、重试 | 仍按当前轮和当前工具 | 不计失败数，不吞不同call-id；原失败结果仍可展开 |
| completed/failed/cancelled，包括旧streaming行未删 | 无轮次活动 | 保留真实结果/风险，不改backend失败 |
| 刷新重连 | 从真实snapshot重算 | 不缓存“成功”；思考和调用内容可展开 |
| 旧轮尚有streaming行，新轮运行 | 仅最新轮活动 | 旧行后台状态仍保留 |
| 1/10/50调用与320/390窄屏 | 一个活动 | 历史独立限高滚动；不恢复无限日志 |

保留原TTFT诊断：没有真实工具时可展开耗时区域，但不生成等待/初始化/思考假步骤。未知耗时保持未知。单测、真实React浏览器截图与正常外网历史读取分别记录；不以fixture冒充收费流式业务验收。
