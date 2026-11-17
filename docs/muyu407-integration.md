# MUYU-407 交给 MUYU-365 的集成验收

本单不发布、不合主干、不改平台状态。先集成 Core 的消息操作接口，再集成 core-web；完整提交 SHA 和本地证据由任务根 REPORT.md 提供。没有数据库迁移和 Shared 升级。不要重新启用 externalStore 的旧 onReload，否则会在父会话追加一轮，违反前缀隔离。

## 行为与部署顺序

1. Core：`GET feedback-stats`，`GET {id}/feedback`，`PUT/DELETE {id}/messages/{messageId}/feedback`，`POST {id}/fork`。普通会话鉴权和所有权隔离；反馈元数据持久化。API 合同见 Core `docs/message-actions.md`。
2. Web：仅 React 聊天岛，Vue 默认页保留原行为。分叉回执经 ChatHost 的 onFork upsert 入现有侧栏并导航。复制沿用 session-guarded 原文写入；编辑保存建新分支，编辑发送/重新生成先复制不含旧问题的前缀，再调用既有 follow-up。
3. 已完成代码自审、离线测试与体积检查。365 按原发布合同完成正式 TEST 集成后再做以下真实验收。不得用本地 DOM 测试或静态截图替代 TEST。

## TEST 截图和验收矩阵（本单全部 NOT_RUN）

使用任务自有 biz-browser 及合法普通账号；不得把 9441/9442 用作业务浏览器。确认实际部署 Core/Web 完整 SHA；创建含三个用户问题的测试会话，明确业务费用余额后才发送模型请求。

| 场景 | 检查 / 截图 |
| --- | --- |
| 反馈 | 助手回复好评→差评互斥；差评八原因按钮及详情保存；刷新后状态/详情一致；再次点击当前评分撤销；网络失败不伪造成功，恢复后可重试 |
| 分叉 | 点第二条用户消息分叉；新会话只有截至该问题的前缀，父会话第三问及原答案不变，侧栏有新会话；刷新仍一致 |
| 编辑 | 原文字节及附件显示一致；Cancel/Escape 不写；Save 新分支末条是改文；Send 新分支只发送一次，保留附件，父会话不变 |
| 重新生成 | 对中间答案操作，只取其父问题和之前历史，后续问题不进入分支；原答案保留；运行中操作禁用，不重复请求 |
| 复制 | 原始 Markdown、Unicode、空格及换行一致；剪贴板失败提示并可重试 |
| 权限 | 第二个普通账号请求源/分支反馈和分叉均 404；未登录 401；统计不含他人数据；删除的会话不能操作 |
| 执行链 | 在分支继续聊天，查真实 Core→executor→原生 CLI 调度证据；验证工具、技能、附件、取消、断线续传及隔离；不得直连模型旁路 |

可先运行只读截图辅助脚本（不创建会话、不投票、不发送、不新开页签）：

```sh
node tests/browser/muyu407-message-actions.cjs /absolute/path/to/playwright-core BUSINESS_CDP_URL OWNED_TARGET_ID CORE_WEB_ORIGIN CONVERSATION_ID OUTPUT_DIR
```

脚本要求已打开指定目标和 React 会话页，采集操作组、编辑原文及已有负反馈详情；余下写操作场景由矩阵验收。`screenshots.json` 只是执行记录，成功截图不证明部署 SHA/环境，不证明未执行场景通过。脚本只断开自己的 CDP 连接，任务浏览器生命周期仍由 biz-browser 租约管理。

## 体积与回滚

复用 `node scripts/muyu365-bundle-size.mjs dist BASE_DIST`；不得增阈值或删除功能。当前 React 岛余量很小，365 合入其他分支后必须重新测完整候选。策略 JSON 在本单离线测量中未提供，CSS 单列，不声称 JS+CSS+JSON 小于 180 KiB。

回滚优先恢复本单前的 Web/Core 候选 SHA（见 REPORT）；保留已存反馈和分支数据，不删除用户历史。上线仍执行 298/382 formal-entry plan→release、逐环境回执、中文发布说明等既有合同，由 365 负责。
