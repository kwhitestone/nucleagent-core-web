# MUYU-410 G1：六项逐源码对照

2026-11-19。继承 `muyu410-owui-comparison.md` 原有消息、Markdown、代码块、搜索、改名、删除、置顶对照。本文件补齐六个缺项，亲读固定源码，没有新增产品实现或生成调用。

## 固定版本与路径

- O：OWUI `c38885a1a737da4968f157092f304f3b5481d0bf`；下文 O 路径相对 `src/lib/components/`。实际读取任务 `owui-src/tar/open-webui-c38885a1a737da4968f157092f304f3b5481d0bf/`，不引用移动的上游 main。
- W：core-web `8918eccf2ffea5561036c623961e330af2f0ed09`；下文 W 相对仓库根；从 `cw-scroll` 创建独立 `g1-docs` detached worktree，基线同 SHA。
- S：主壳 `a71344647b5b10a73a27063f0ceba68f2009d895`；亲读 `shell-dev`。
- C：DEV Core `3ed72e17be0b0de66a8b48c63625771315647251`；亲读 `alternative-integration/core/nucleagent-core`。C 的源码不冒充其他三环境 Core 精确版本；四环境命名一致性另见历史样本。
- 四环境 W/S 部署来源：`deploy-scroll/docs/releases/nb.2026.11.19-41002/release.yaml` 与 `41001/release.yaml`；本轮不重新发布。版本是继承部署证据，不等于当前在线版本重测。

## 1. 自动标题

O `chat/Chat.svelte:4555`：首轮、非临时聊天的 `background_tasks` 携带 `title_generation: $settings?.title?.auto ?? true`（4561）；开关默认开启，属于模型生成标题链路。另一个明确的模型调用在 `Chat.svelte:2325`，但**它是语音标题路径**：调用 `generateTitle(token, modelId, messages, _chatId)`，失败取 null；2331 重新读取会话，仅原标题未被改动才更新，2333 回退 `content.slice(0,100)`，2336 更新当前标题 store。不能用语音路径替代普通文字触发时序证明。

C `app/src/server/addons/conversation/svc/service.go:240` 在创建会话记录时使用 `firstLine(req.Input,80)`；同文件2418逐字符找到首个换行，2425按 rune 截断，2427拼 `…`。因此准确描述是“首行最多80个 rune，截断时另加省略号”，不是模型概括，也不是严格总长80。标题由历史行/会话头显示；没有为标题生成独立 spinner、按钮或动效。重命名的80字限制是另一条接口规则，不能混为同一算法。

偏离理由：原目标只要求自动标题；保持创建时即时确定的现有命名，不引入额外模型成本和异步覆盖用户标题风险。历史样本只证明已保存标题与首行一致，不证明新生成时序或长文本边界已在线重跑。

四环境映射：`acceptance-evidence/{dev,test,pre,prod}-scroll.json.candidates[].titleMatchesInputFirst80`、`acceptance-evidence/title-history-summary.json`。本轮继承；不新建会话。

## 2. 附件

O `chat/MessageInput.svelte:1943` 的隐藏 `type="file"` 输入接选择文件；`MessageInput.svelte:2486` 菜单上传入口触发选择。文件列表在输入区域上方，2235渲染 `FileItem`，2240以 `file.status==='uploading'` 显示 loading；2241允许关闭，2245 dismiss 从本地 `files` 数组移除。它同时支持更丰富的 collection、编辑和外部网盘入口（2489/2509），不能把这些算作我方已实现。

W `src/chat-react/ChatApp.tsx:314` 使用 AttachmentDropzone；315输入框容器内挂附件，333文本输入、工具行里 AddAttachment（“添加附件”来自 `islandStringsZh.ts:26`）。`src/chat-react/attachments.ts:15` 适配 Storage：23 running/uploading/progress=0，25超大小进入 incomplete/error，35异步上传与进度，47上传成功进入 requires-action/composer-send，49失败反馈。移除的是草稿附件，已上传对象留存按既有 Storage 合同；不将 chip 消失说成物理对象删除。没有承诺 OWUI 网盘/collection/编辑或其独立动效；进度反馈来自状态更新。

偏离理由：保留项目 Storage 上传/签名/owner 边界和受控附件适配，不复制 OWUI 外部网盘能力。四环境均继承 `acceptance-evidence/{env}-upload.json`（actions、字节/hash、未生成及清理结果）与 `{env}-uploaded.png`、`{env}-upload-cleaned.png`。DEV 旧下载 UNKNOWN 和 Storage 保留披露继续有效，不重放。

## 3. 停止

O `chat/MessageInput.svelte:2863`：isActive、当前用户所有、prompt为空且files为空时，输入区操作行显示圆形 Stop tooltip/button（2865/2867），hover/transition 样式，2870调用 stopResponse；有输入时停止入口与队列布局不同。`chat/Chat.svelte:4681` 再核 response owner，4685取消语音动画；4695 stopTasksByChatId，4701逐任务 stopTask 为无 chatId 分支；错误 toast；4708清 taskIds，4713将同父回复 done，4725 abort 本地生成 controller，4729按参数处理队列。

W `src/chat-react/ChatApp.tsx:305` 依据 composerActions 选动作，343发送/排队，346 `ComposerPrimitive.Cancel` 显示方块“停止”，`islandStringsZh.ts:24` 文案。`composerState.ts:5`：运行+空输入仅stop；运行+有输入同时queue/stop；非运行send。`externalStore.ts:44` onCancel→controller.stop，`task-conversation/conversationController.ts:565` stop流程（572执行stop）。位置在输入框右侧，发送和停止不是始终同时出现；没有单独停止入场动效。

偏离理由：保持 Core→executor→原生CLI 的取消合同；不以关闭 SSE 当成后端停止，也不新生成一条收费消息只为再按停止。四环境历史证据具体文件/字段继承 `STOP-ACCEPTANCE-REPORT.md`、`stop-ledger-evidence/` 和 `closure-audit.json.matrix` 的停止项，保留“原单已有真实历史停止、当前版本源码链路”的证据层次，不冒称本轮按钮实按。

## 4. 滚动

O `chat/Chat.svelte:5419` 消息容器独立滚动，5425底距5px或仍向下滚动时保持 autoScroll，5429记录近顶100px；3134 scrollToBottom 默认 behavior=auto，3144两帧重滚处理内容高度解析，3169同时尊重 scrollOnResponseGeneration，3174用 requestAnimationFrame 合并。`chat/MessageInput.svelte:1907` 提供 Scroll to bottom 按钮。这里不能仅据 autoScroll 变量宣称 OWUI 有与我方一样的跨会话32项位置缓存。

W `src/chat-react/ScrollViewport.tsx:8` 身份边界变化清缓存，18必须ready才恢复；27底距48px算跟随，29按conversationId缓存，32最多32项；37用消息锚点和偏移恢复，38跟随时到底；44 requestAnimationFrame；47/49监听 resize/mutation。59关闭 aui 内置自动滚动；`ChatApp.tsx:160` ready同时核匹配 conversationKey 和 authoritativeReady。恢复是直接 scrollTop，不冒称 smooth 动效；按钮/历史重进与缓存不是持久数据库状态。

偏离理由：适配异步快照和 iframe，避免切换期间旧会话 snapshot 错误覆盖位置；阈值48px是产品实现差异。四环境 `scroll-release/{env}-scroll.json` 的 before/after、positionRetained、messagesUnchanged、pass，及对应 before/after/history截图；本轮只继承检查。

## 5. 空态

O `chat/Placeholder.svelte:291` 输入框提示 How can I help you today?；316建议区域 fade duration200/delay200，318 Suggestions。`chat/Suggestions.svelte:61` 打乱顺序，68标题 Suggested，85容器h-36内部滚动，94按钮带 transition-colors，98逐项45ms延迟，99 onSelect(prompt.content)。它使用动态建议集合，并非固定“6张”。只据此回调不推断父级一定自动发送。

W `src/chat-react/ChatApp.tsx:185` Welcome：189“今天想完成什么？”（`islandStringsZh.ts:31`），193 suggestion trigger 明确 send={false}，194/195标题/描述；205按空会话获取建议。`chat.css:48` 中央max-width760，50网格minmax220，62 hover，497窄屏规则，501单列；未实现 OWUI 分批 waterfall/fade。`ChatApp.tsx:333` 输入框，343 Send沿用 aui 空输入禁用。六卡数量是线上数据观察，不能从循环源码推成永久固定数量。

偏离理由：沿用项目首页建议和中文问候，避免卡片点击自动产生付费会话。DEV/PROD已存 `terminology-release/{dev,prod}-adjacent-acceptance.json`（suggestionCount=6、suggestionFillsOnly、emptySendDisabled）和 mobile-empty截图。TEST/PRE必须在 G2 单独补真实DOM和无生成网络证据；不得把DEV/PROD扩写成四环境通过。

## 6. 移动主壳与历史入口

O `layout/Sidebar.svelte:732` 移动宽度 min(380,viewportWidth-40)，1056附近 MobileSwipePanel 绑定 `$mobile`/showSidebar，1061更新开关；1071移动遮罩，1075用backdropStyle跟随进度，1077按遮罩关闭；1284按visible/mobile渲染。它是抽屉和遮罩的移动侧栏，不能用桌面宽度折叠代替。

S `src/addons/shell-chrome/components/AppSidebar.vue:445` 桌面侧栏，452宽度transition，458折叠，462隐藏历史区；471在max-width1023.98px直接display:none，475 reduced-motion关闭动画。`navigation/sidebarState.ts:12`断点，48附近sidebarMode对mobile固定hidden。`components/ShellChrome.vue:73`挂侧栏，81底部 AppTabBar；`components/AppTabBar.vue:53`聊天、55任务入口。`components/AppTopbar.vue:86`的sidebar-toggle需按其可见条件及断点判断，不能推成390px能打开抽屉。W聊天体在520px单列、代码块 `chat.css:282` overflow-x:auto，表格300内滚动；ShellChrome.vue:100 min-width:0防主区撑宽。

偏离理由：当前主壳移动导航既有设计是底部tab+任务台，**没有OWUI式移动侧栏抽屉**。这是实质可见差异；本轮禁止范围扩张，不擅自补抽屉。G2应验证实际历史入口导航并如实记390px侧栏不可开关，不能写成“移动侧栏通过”。四环境桌面历史证据沿用 `closure-audit.json.matrix` 搜索/历史项；DEV/PROD仅有空态窄屏，不能替代非空窄屏。四环境非空输入可见/不溢出/代码内滚动/导航均由 G2 单独裁定。

## 证据口径

源码对照六项已补齐；实现相同不是门槛，差异不能隐去。四环境映射为上述精确文件模板，env取dev/test/pre/prod，缺项明确标记。机器矩阵、文件sha256、截图查看记录和最终结论位于任务 `g1-g2-evidence/` 与 `G1-G2-CLOSEOUT.md`。没有新增部署事务、运行digest仍UNKNOWN、双身份集成替代与Storage保留沿用既有披露。
