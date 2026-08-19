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
