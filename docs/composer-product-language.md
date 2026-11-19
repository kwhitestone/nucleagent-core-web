# 输入区与设置产品语言

本次只调整入口、布局与普通用户文案，不改变模型支持判定、白名单、默认值、自动保存、参数优先级或执行链。`requestEffort.ts`、`modelProfile.ts`、`useModelPreference.ts`、`workflowParams.ts` 与 owner picker 的能力证据及请求逻辑保持原样；隐藏工程说明不代表模型效果已验证。

| 旧默认展示 | 新展示 | 保留的行为 |
| --- | --- | --- |
| 输入框外独立“生成工具” | 输入框内“＋ → 生成工具”，展开可收起参数面板 | STT、TTS、媒体工作流按原目录/权限显示，实际提交和 UNKNOWN 禁重放不变 |
| 思考强度 · 平台已验证上游接受，效果未实测 | 设置按钮旁仅显示实际发送的“低 / 中 / 高” | 来源、有效性、可用级别仍由内部证据对象控制 |
| 设置内平台已验证/上游接受/未实测/原生链等过程提示 | 不作为用户说明展示；不可用时短标“暂未开放” | 不将未验证误报为模型不支持，不宣称低强度必然更快或便宜 |
| 预设禁用项长原因与默认长 tooltip | 预设名（暂未开放）；短同义 tooltip | 原 enabled、disabled、efforts 字段不变 |
| 自动保存、优先级、temperature / top_p / max tokens 长清单 | 自动保存；思考强度优先于预设。 | 已可用的设置、保存错误与参数优先级不变；没有控件的底层参数不宣称开放 |
| 默认模型的中心/原生身份长解释 | 使用默认模型。选择具体模型可查看可用设置。 | 默认模型解析和加载/保存门不变 |

内部历史语义保留：backend=仅 Codex 执行器支持；unverified=未实测该模型是否生效；ineffective=已实测对该模型不生效；effective=已实测对该模型生效；server=平台已验证上游接受、效果未实测。状态仍由证据代码持有；本次移除的仅是无消费者的普通 UI 翻译字串。

参考固定 OpenWebUI v0.13.3，提交 `b0e6098e940942281d9c83f3529ea117287a3a22`：

- https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/chat/MessageInput.svelte ：2583 起 InputMenu 位于输入框操作行，关闭后恢复输入焦点，integrations slot 复用同一菜单。
- https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/chat/MessageInput/InputMenu.svelte ：文件权限/数量门、附件选择、菜单子页与可视视口高度约束。
- https://github.com/open-webui/open-webui/blob/b0e6098e940942281d9c83f3529ea117287a3a22/src/lib/components/chat/MessageInput/IntegrationsMenu.svelte ：工具目录与图片生成是不同功能；工具选择/返回在同菜单内，不将生成工具与图片快捷方式误当重复功能删除。
- 固定 README 引用的官方演示 https://cdn.openwebui.com/open-webui-demo.gif ，本任务已查看第150帧输入区。CDN 动图未绑定 Git 提交，不冒称该帧与源码版本完全一致；代码行为以上述 SHA 为准。

目鱼保留图片/视频直选和新对话工作流两条不同合同。工作流参数表单在统一输入框内展开，和聊天表单为兄弟节点；收起保留已选参数与聊天草稿，账号变化清空工作流，Escape 归还“＋”焦点。已有会话保持原先只开放附件、模型与绑定媒体工具的边界。
