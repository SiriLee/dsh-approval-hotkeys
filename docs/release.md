# dsh-approval-hotkeys 发布流程

> 完整指南见姊妹项目
> `dsh-edit-approval/docs/npm-trusted-publishing-guide.md`（Trusted Publishing
> 实测闭环：0.1.0 本地 2FA 首发 → 配置 Trusted Publisher → 后续 CI OIDC 发布并
> 附加 Sigstore/SLSA provenance）。

## 首次发布（手动，一次性）

Trusted Publisher 必须**包已存在**才能配置，因此首个版本走本地发布：

```sh
npm login
npm publish --access public
```

- 若提示 `EOTP`（一次性密码）：按 CLI 输出的浏览器认证链接完成认证，或用
  authenticator 的 6 位码 `npm publish --otp=<code>` 重试。
- 首个版本无 provenance（本地路径），合规；后续 CI 发布自动带 provenance。

## 配置 Trusted Publisher（npmjs.com，一次性）

打开 `https://www.npmjs.com/package/dsh-approval-hotkeys` → 包右上角 **settings**
→ **Trusted Publisher** 区块：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | SiriLee |
| Repository | dsh-approval-hotkeys |
| Workflow filename | `publish.yml` |
| Environment | 留空 |
| Allowed actions | `npm publish` |

## 后续发布（CI 自动）

```sh
npm version patch
git push origin main --tags
```

`publish.yml` 触发：Node 24 + npm≥11.5.1 校验 → typecheck/test/build/verify →
tag/版本一致性 → 幂等守卫 → `npm publish --provenance --access public` →
GitHub Release（自动生成 notes）。

## DSH 版本对齐（peer 范围）

DSH 仍处于 rc 阶段。npm 的 prerelease 匹配规则是：带 prerelease 的版本，只有在
**同一个 `||` 分组**里存在一个「同名 major.minor.patch 且自身带 prerelease」的
比较器时才可能被匹配。因此**每个出过预发布的 tuple 必须占一个 `||` 项**——
`>=0.1.0-rc.6 <0.2.0` 这类写法会静默漏掉 0.1.0 之外所有 tuple 的预发布
（包括实测通过的 `0.1.5-rc.1`）。

当前声明 = 从 `0.1.0-rc.6` 起的**整条 0.1 线（含预发布）**：

```
^0.1.0-rc.6 || ^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0
```

- `-0` 是某个 tuple 最低的预发布，`^0.1.N-0` 即「0.1.N 整个 patch，含预发布」，
  所以同 tuple 内的 rc.2 → rc.3 滚动（以及 alpha 系列）**不需要再改**。
- 首个 tuple 必须用 `-rc.6` 作下限（排除更早的 `rc.2`/`rc.3`），不能用 `-0`。
- `^0.1.0-rc.6` 同时覆盖 0.1.x 的稳定版；`0.2.0` 与 `0.2.0-rc.*` 都不匹配。
- 出现**新 tuple**（`0.1.6-rc.1`、`0.2.0-rc.1` …）时必须追加 `^<tuple>-0` 项——
  `node scripts/check-dsh-version.mjs`（exit 1）就是用来提醒这一步的。

peer 包名用 `@deepseek-ai/dsh-client-modules`（客户端模块系统，npm 上自
`0.0.1-rc.1` 起全线在列），这是唯一能贯穿整条 0.1 线的客户端运行时锚点。
旧的 `@deepseek-ai/dsh-client-runtime` **只发布到 `0.1.1-rc.2`**，之后不再随 DSH
发版，对它声明 `^0.1.2-rc.1` / `^0.1.5-rc.1` 永远匹配不到任何已发布版本；该名字
仅作为 `dsh.client.inject` 的旧版本排序 token 保留（0.1.2+ 的
`dsh-client-modules` 会静默忽略未知 inject 名）。

`devDependencies` 里的 `@deepseek-ai/dsh-client-runtime` **必须保持钉在
`^0.1.1-rc.2`**：它是 `src/client/index.ts` 与 `tests/hotkeys.test.ts` 的编译期
类型来源，该包已停发，bump 或替换会直接打断 typecheck / 测试。在类型 import
迁移到现代路径（cordis 的 `Context`、`@deepseek-ai/dsh-api-session-controller/client`
的 `SessionFace`）之前不要动它——它与 peer 声明无关，不要"顺手对齐"。

`dsh.engines.dsh` 声明运行时下限（`>=0.1.0-rc.6`），供插件管理器做下限守卫。
注意：在 DSH `0.1.5-rc.1` 对应的 DSH 源码与 dsh-market 中均**未发现**读取该字段
的实现（dsh-market 只读 `peerDependencies` / `peerDependenciesMeta`），因此它是
声明性元数据，不要当作唯一的兼容信号。

DSH 转正式版后 prerelease 规则不再约束，上面整串可收敛为单一稳定范围
（如 `^0.1.x`），本节即可删除。
