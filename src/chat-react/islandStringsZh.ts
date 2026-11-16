/** zh-CN island strings: their own lazy chunk, downloaded only for Chinese sessions (island size budget, §21). */
export const ZH_STRINGS = {
    reasoning: "思考过程",
    attachmentPending: "附件待核验，暂不可下载",
    stop: "停止", executor: "目鱼执行器", mediaLater: "即将开放", pickerLabel: "模型与执行器",
    newPlaceholder: "描述你的任务", hint: "Enter 发送 · Shift + Enter 换行", queueSend: "加入待发送（当前回复结束后发出）",
    genImage: "生成图片", genVideo: "生成视频", mediaLaterTip: "即将开放", attach: "添加附件", loading: "正在加载对话…", process: "执行过程",
    queued: "待发送 1 条", queuedRemove: "移除待发送消息", badUpdate: "消息格式异常，已跳过一条更新",
    reload: "重新生成", edit: "编辑", fork: "分叉对话", good: "好评", bad: "差评", feedbackDetails: "反馈详情", not_helpful: "没有帮助", other: "其他", save: "保存", send: "发送",
    dont_like_the_style: "不喜欢这种风格", too_verbose: "过于冗长", not_factually_correct: "事实不正确", didnt_fully_follow_instructions: "未完全遵循指令", refused_when_it_shouldnt_have: "不该拒绝却拒绝了", being_lazy: "敷衍了事",
    toBottom: "回到底部", earlier: "加载更早消息", running: "进行中", done: "完成", failed: "失败",
    query: "查询", sources: "来源", doneSteps: "步成功", cancelled: "已停止", tool: "工具", mediaPending: "生成中…", mediaFailed: "生成失败", thinking: "正在思考…", greeting: "今天想完成什么？",
    firstToken: "首字", queue: "排队", upload: "上传附件", agentReady: "Agent 就绪", upstreamFirst: "上游首字", sec: " 秒", approx: "约 ", serverMeasured: "服务端计",
};
export type IslandStrings = Record<keyof typeof ZH_STRINGS, string>;
