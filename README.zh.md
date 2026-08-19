# dsh-approval-hotkeys

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**审批面板快捷键**插件，
作用于**所有来源**的审批（不只编辑审批）。

> [English](README.md) | 中文

刻意保持极简：两个键，两处场景。

| 按键 | 场景 | 动作 |
| --- | --- | --- |
| `Enter` | 审批面板在场 | **允许一次**（点击「允许一次」） |
| `Esc` | 审批面板在场 | **拒绝**（点击「拒绝」） |
| `Esc` | 无面板且 agent 运行中 | **暂停**（停止当前回合，排队消息保留） |

审批面板的 `[data-approval-key]` 锚点是 harness 通用锚点，因此快捷键对 GUI 展示的
**一切审批**生效——编辑审批、权限升级、任何走 ApprovalPanel 的请求。这就是 Claude Code
的手感：Enter 放行，Esc 拒绝。

## 安装

```sh
dsh plugin --profile web add dsh-approval-hotkeys
```

重启 `dsh web`（或刷新页面——host 未变时刷新即加载新 client bundle）。无需任何配置。

## 原理

- **Enter → 允许一次**：点击面板最后一个按钮（「允许一次」）。
- **Esc → 拒绝**：点击面板第一个按钮（「拒绝」）。
- **Esc → 暂停**：调用 `session.cancel()`——与 GUI「停止生成」按钮同一个动词；
  停止当前回合，之后排队消息按 FIFO 继续。

### 守卫（刻意不做的事）

- **输入中不拦截**：焦点在 input / textarea / select / contentEditable 时交还输入框
  （`Enter` 发送、`Shift+Enter` 换行、`Esc` 收起联想都属于输入框）。
- **组合键与连发不拦截**：`Ctrl/Meta/Alt+键` 与按住连发交给系统。
- **弹窗下不暂停**：`role="dialog"` 覆盖层（如设置页）打开时，`Esc` 属于弹窗。
- **面板优先**：面板在场时 `Esc` 永远拒绝，绝不暂停。

### 设计要点

- 纯浏览器（client）插件：host 半边是空桩；全部行为是注册在单个 `ctx.effect` 里的
  一个 `document` `keydown` 监听器，卸载/HMR 时解绑。
- 依赖稳定的 ApprovalPanel DOM 契约：拒绝在前、允许一次在后、回答后按钮 disabled——
  既不可能重复应答，按钮顺序也是与 harness 唯一的耦合点。
- 面板查找优先匹配当前会话的待审批 key，找不到再取 DOM 中第一个面板。

## 开发

```sh
npm install
npm run typecheck   # tsc --noEmit（host + client）
npm test            # vitest（jsdom 单测，覆盖 dispatch 全部分支）
npm run build       # esbuild：lib/index.js + lib/client.js + .d.ts
node scripts/verify-host.mjs
```

## 发布

首次发布需手动执行一次 `npm publish --access public`，之后由 GitHub Actions
**Trusted Publishing** 接管——推送 `v<semver>` 标签即自动带 provenance 发布。
完整步骤见 [docs/release.md](docs/release.md)。

## 许可

[MIT](LICENSE)
