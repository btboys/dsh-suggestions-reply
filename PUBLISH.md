# 发布说明

当前产物：`dsh-suggestions-reply@0.1.0`，仓库 `https://github.com/btboys/dsh-suggestions-reply`。

## 1. 发布到 npm

```bash
cd /Users/gson/IdeaProjects/dsh-suggestions-reply
npm login
npm publish --access public
```

- 包名 `dsh-suggestions-reply` 在 npm 上未被占用（已核验）。
- 当前环境 `npm whoami` 返回 401，未登录，这一步需要在有 npm 凭据的终端里执行。

## 2. 加入插件市场索引

`market-entry.json` 的内容已追加到站点索引 `worktree/plugins/site/index.json`（与 `worktree/plugins/index.json` 保持同步），图标已放到 `site/icons/dsh-suggestions-reply.svg`。发布后补全：

- `versions[0].publishTimestamp`：以 npm 实际发布时间为准，发布后执行
  `npm view dsh-suggestions-reply time --json | grep 0.1.0` 拿真实时间再改这一处（当前是预填时间戳）。
- 站点文件更新后需部署到 dsh.gson.cn 才对外生效。

## 3. 用户安装

市场：设置 → 插件 → 发现 → 「追问胶囊与消息模板」→ 安装。

本地目录安装：Plugins → Add plugin 填入 `/Users/gson/IdeaProjects/dsh-suggestions-reply`。

## 4. 本地验证

```bash
node --check index.js && node --check client.js   # 语法
npm pack --dry-run                                 # 检查发布内容（10 个文件）
```

本机 desktop profile 已 link 安装并实测：追问生成、模板 CRUD、sendMode、SSE 实时同步均通过。