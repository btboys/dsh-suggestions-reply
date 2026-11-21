# 追问胶囊与消息模板

[English](README.md) | 中文

一个 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 插件，为对话增加两个界面：

1. **追问胶囊** —— 每轮回答完成后，在回答下方生成 1–3 条可点击的追问，锚定回答正文、以你的口吻表述，点击即作为普通消息发送。
2. **消息模板** —— 输入框上方的常用话术/高频指令芯片行，每条模板可设为点击「填入输入框」或「直接发送」。

## 追问胶囊

回合完成后，插件发起一次辅助模型请求，读取该回合的用户提问与回答，返回 1–3 条锚定正文的短建议（具体的下一步、澄清、扩展或验证），以品牌色浅底胶囊渲染在回答下方。

- **点击即发送**：走输入框的正常提交通路——空闲会话立即发送；运行中按你配置的「排队/转向」方式投递。
- **仅最新回合**：只在会话空闲时显示最新完成回合的胶囊；新回合开始即消失，回看历史不显示旧胶囊。
- **模型路由**：辅助请求默认沿用会话当前模型；在插件行配置中同时设置 `provider` 与 `model` 可固定其它路由。
- **不污染日志**：建议按会话/回合缓存在内存中，不写入会话日志；重启后查看最新回合时按需重新生成。
- **跳过的情形**：中断、报错、达到输出上限的回合以及子代理会话不生成胶囊；辅助请求失败或超时则该回合不显示。

## 消息模板

输入框上方的芯片行展示已保存的模板，与对话内容列对齐。

- **逐模板点击行为**（`sendMode`）：
  - `fill`（默认）—— 点击把文本填入输入框，手动编辑后发送。
  - `send` —— 点击立即作为普通消息发送；直发芯片带 ↑ 箭头与浅色描边。
- **「管理模板」弹层**：添加、编辑、上移/下移排序、删除；列表行带「填入/发送」徽标，编辑表单内有「点击行为」分段开关。
- **实时同步**：模板保存在 Host 的 `suggestions_reply` 存储域（`$DSH_HOME/storages/suggestions_reply.json`），不在浏览器本地。连接同一 Host 的所有页面——desktop 窗口、浏览器标签、远程 Web UI——共享数据并经 SSE 实时刷新；窗口重新聚焦也会补拉一次。独立启动的另一个 Host 进程各自维护状态。
- **持久可靠**：模板跨重启、跨插件升级保留；旧模板无 `sendMode` 字段时自动迁移为 `fill`。
- **限制**：默认上限 50 条（`maxTemplates`），标题 1–60 字符，内容 1–4000 字符。

### Agent 工具

Agent 通过 `message_templates` 工具管理同一份模板（与 UI 共用同一套 Host 方法）：

| 动作 | 参数 | 返回 |
|---|---|---|
| `list` | — | 全部模板（含 id，按序） |
| `add` | `title`、`text`、可选 `sendMode` | 新建的模板 |
| `update` | `id`、可选 `title` / `text` / `sendMode` | 更新后的模板 |
| `remove` | `id` | `{ removed: true }` |

`update`/`remove` 前先 `list` 读取准确 id 与当前内容；失败返回 `{ ok: false, error }`。

## 安装

要求 DSH `>=0.2.1-rc.3 <0.3.0`、Node `>=22`。

- **npm 安装**：在 DSH 中让 Agent 安装 bundle `dsh-suggestions-reply`，或在 **Plugins → Add plugin** 填入包名。
- **本地目录安装**：**Plugins → Add plugin** 填入绝对目录路径，或用 `plugin_manager` 的 `install_bundle` 指向该路径。

插件即时激活，两个界面在所有会话生效。可随时在 **Plugins** 中禁用或卸载——已保存的模板会保留。

## 插件行配置

在 **Plugins** 页面编辑该插件行的配置，或在 profile 的 `cordis.patch.yml` 中覆盖：

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 生成并显示追问胶囊。 |
| `maxSuggestions` | `3` | 每回合胶囊数量（1–3）。 |
| `provider` / `model` | 空 | 辅助请求路由；为空则沿用会话当前模型，两者需同时设置。 |
| `maxOutputTokens` | `300` | 辅助请求输出 token 上限。 |
| `timeoutMs` | `20000` | 辅助请求超时（毫秒）。 |
| `maxInputChars` | `6000` | 送入辅助请求的回答文本预算（保留尾部）。 |
| `templatesEnabled` | `true` | 模板行、管理弹层与 Agent 工具。 |
| `maxTemplates` | `50` | 模板数量上限。 |

## 数据与隐私

- 辅助请求会把该回合的首条用户提问（≤2000 字符）与回答末尾文本（≤`maxInputChars`）发送给会话的模型提供方（或你固定的路由），请求标记 purpose 为 `suggestions-reply`，不记录进会话日志。
- 模板仅保存在本机 `$DSH_HOME/storages/` 下，其余数据不出本机。
- 关闭插件即移除两个界面与工具；模板数据保留。

## 已知限制

- 胶囊质量取决于辅助模型；回答空泛时建议也会空泛。
- 每个完成回合一次辅助请求，带来少量 token 成本（受 `maxOutputTokens` 约束）。
- 不提供跨进程实时同步（两个独立 Host 进程）；请共用同一 Host 的 Web URL。

## 开发

```text
index.js          Host 半区：投影、生成、存储域、RPC + SSE 路由、Agent 工具
client.js         Client 半区：胶囊行、模板坞、管理弹层
cordis.patch.yml  Bundle 补丁（一条插件行）
locale/           Plugins 页展示元数据（en、zh）
icon.svg          插件图标
```

```bash
node --check index.js && node --check client.js   # 语法检查
npm pack --dry-run                                 # 核验打包文件清单
```

## 许可证

[MIT](LICENSE)