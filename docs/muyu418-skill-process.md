# 技能过程状态

聊天页将 Core 的 `system/status` 消息作为执行过程中的步骤显示。历史查询与 SSE 使用相同适配规则，消息本身不会变成答案或工具调用。

- `agent.skill_match`：显示服务端 `content`，保留未匹配、超时、登录过期、本地回退以及下轮生效等说明。`failed`、`not_written`、`timeout` 保留失败状态。
- `agent.skill_intent`：gate 显示 `need=tool/none/keep` 的产品摘要；probe 保持隐藏。判断失败明确提示已继续处理请求，不展示模型、token 或内部错误。
- `dispatch_mode=parallel`、`effective_turn=next` 是可选扩展，缺失不影响旧消息。下一轮生效的消息不宣称技能已用于本轮；后台耗时不作为用户等待时间。
- 技能步骤不提供主回复的计费身份。异步图片/视频仍使用自己的 `media-<taskId>` 结算证据；费用未知保持未知。
- 过程折叠区沿用现有样式。纯工具记录仍显示“次调用”，包含技能状态时显示“个步骤”。所有消息内容按文本转义。

回归覆盖历史与 SSE、未知字段、probe 过滤、失败状态、计费隔离、无工具调用时的展示，以及 1131 媒体费用/自动更新。composer 工具测试夹具补齐现有 `skillIds` 与列表 `known` 合同，不再在进入音频参数流程之前崩溃。
