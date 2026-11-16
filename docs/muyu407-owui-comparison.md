# MUYU-407 OpenWebUI 消息交互对照

源码：本任务 owui-src；LOCK.txt：v0.13.3，完整提交 b0e6098e940942281d9c83f3529ea117287a3a22。以下路径相对该源码根。

| 交互 | 源码与位置 | 控件、状态与文案 | 目鱼适配 |
| --- | --- | --- | --- |
| 复制 | src/lib/components/chat/Messages/ResponseMessage.svelte:236；UserMessage.svelte 操作组 | 消息下方图标，Copy / Copied，失败可再试，复制原内容 | 沿用现有 copyRawBody、会话身份守卫和状态播报；不复制 Markdown 渲染 DOM |
| 点赞/点踩 | ResponseMessage.svelte:494 feedbackHandler；同文件 thumbs-up/down 操作组 | 互斥 rating；加载中禁重入；切换清理由；点击已选撤销；负反馈可展开原因与详情 | 消息下方按钮、aria-pressed；持久化 Core 元数据；只评价最终答复；失败不伪造选中 |
| 分叉 | src/lib/components/chat/Chat.svelte:3915 handleForkChat；ResponseMessage.svelte:1294 | Fork chat；生成中不允许；成功导航 /c/id 并刷新侧栏；失败 toast | 上游入口位于完成的助手消息；本单明确要求从任意用户消息分叉，故将同语义控件放到用户消息操作组，复制截至该用户点的前缀；侧栏立即 upsert 新会话；不携带父执行 nonce/CLI 会话 |
| 编辑 | UserMessage.svelte:105、124、326 | 以原文填 textarea；Cancel / Save / Send；Escape 取消、Ctrl/Cmd+Enter 发送；保留附件 | 编辑用户消息；保存创建含改文的新分支，发送创建不含旧 pivot 的分支后 follow-up；原历史保留 |
| 重新生成 | Chat.svelte:4901 regenerateResponse | 回答下方重新生成图标，取该回答的父用户消息，生成中禁用 | Core 没有树形 sibling response；创建用户点之前的前缀分支，再沿原 follow-up 执行同一问题和附件，旧答案不丢 |

皮肤沿用 mc-actions、mc-icon-btn 以及目鱼 token，悬停/键盘聚焦显示，末条常显，小屏可触达；采用已有 transition，不引入新的动画库。原因使用 RateComment.svelte:26–36 的全部八个 DISLIKE_REASONS（包括 not_factually_correct / not_helpful / other），依 RateComment.svelte:172 的单选按钮组展示，输入详情可选。服务端采用同名枚举，统计接口按当前用户隔离。正反馈原因不在本单范围。

体积策略：功能仅进入 React 岛，不向默认 Vue /c/:id 引入依赖；复用现有 HTTP、会话刷新和样式。替换旧重新生成实现，避免并存两条发送路径；实测同一脚本，门禁不放宽。
