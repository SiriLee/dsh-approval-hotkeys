# dsh-approval-hotkeys

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**审批面板快捷键**插件，
作用于**所有来源**的审批（不只编辑审批）。

> [English](README.md) | 中文

刻意保持极简，一条通用规则：**Enter 总是按下确认按钮（primary 主色、动作行最右）；Esc 总是按下取消按钮**——
作用于 harness 渲染的每一类带按钮交互面板。

| 面板 | Enter → 确认 | Esc → 取消 |
| --- | --- | --- |
| 审批 `[data-approval-key]` | 允许一次 | 拒绝 |
| 选择/提问 `[data-question-key]` | 提交/下一题 | 放弃整组 |
| 计划审查 `[data-plan-review-key]` | 确认执行 | 拒绝（无拒绝则去聊天） |

面板锚点均为 harness 通用锚点，因此快捷键对 GUI 展示的**一切交互**生效——编辑审批、权限升级、
工具提问、计划审查。这就是 Claude Code 的手感：Enter 确认，Esc 取消。

<img src="assets/screenshots/approval-panel.png" width="780" alt="审批面板 — Enter：允许一次，Esc：拒绝"/>
<img src="assets/screenshots/question-panel.png" width="780" alt="提问/选择面板 — Enter：提交，Esc：放弃整组"/>
<img src="assets/screenshots/plan-review-panel.png" width="780" alt="计划审查面板 — Enter：确认执行，Esc：拒绝"/>

## 安装

```sh
dsh plugin --profile web add dsh-approval-hotkeys
```

重启 `dsh web`（或刷新页面——host 未变时刷新即加载新 client bundle）。无需任何配置。

## 原理

- **Enter → 确认**：点击面板的 primary 按钮——动作行最后一个按钮（「允许一次」/「提交/下一题」/
  「确认执行」）。harness 的 `Button` 组件没有稳定的 `data-variant` 属性（variant 只是 CSS
  Modules 的 hash class），因此插件锚定布局契约：**确认动作总是渲染在最后**——正是那个主色按钮。
- **Esc → 取消**：点击面板的取消按钮——审批=第一个（拒绝）、选择=header 最后（放弃整组）、
  计划审查=footer 倒数第二（拒绝；无拒绝按钮时退化为「去聊天」）。无面板时 Esc 不拦截
  （不做暂停/停止——那是 GUI「停止生成」按钮与既有快捷键的职责）。

### 守卫（刻意不做的事）

- **输入中不拦截**：焦点在 input / textarea / select / contentEditable 时交还输入框
  （`Enter` 发送、`Shift+Enter` 换行、`Esc` 收起联想都属于输入框）。
- **焦点在按钮上时 Enter 不拦截**：交给浏览器原生激活聚焦按钮、以及面板自身
  （选择弹窗的选项自带 Enter 提交）——再处理会双重触发。
- **组合键与连发不拦截**：`Ctrl/Meta/Alt+键` 与按住连发交给系统。
- **无面板时 Esc 不拦截**：插件只作用于交互面板，绝不停止/暂停 agent。

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
