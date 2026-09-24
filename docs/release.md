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
tag/版本一致性 → 幂等守卫 → `npm publish --provenance --access public --tag <dist_tag>` →
GitHub Release（自动生成 notes；仅发到 `latest` 时才标 `--latest`）。

`dist_tag` 来自手动触发的输入；不填时按版本推导（预发布取标识符如 `rc`，稳定版取
`latest`）。**本次 0.1.7 适配版要走 `next`**，见下文「发布 dist-tag」。

## DSH 版本对齐（peer 范围）

### 当前策略：一次发布对一条 DSH 线

peer 只声明**已验证的那条线**：

```
@deepseek-ai/dsh-api-session-controller  ^0.1.7-rc.1
@deepseek-ai/dsh-client-ui-session       ^0.1.7-rc.1
dsh.engines.dsh                          >=0.1.7-rc.1
```

为什么不做跨线并集（本仓库 0.1.6 及更早的做法）：

- harness 会在**同一条线内**删客户端 API 且不给 shim：`0.1.6-alpha.2` 删了
  `SessionListState.current` / `SessionSnapshot.queue`，`0.1.7-rc.1` 删了
  `uiSession.pendingInteractions`。跨线并集会让「声明支持」与「真的能用」脱节。
- **自 `0.1.7-rc.1` 起 peer 在启动时被强制执行**：`@deepseek-ai/dsh-app-boot` 的
  `evaluatePluginCompatibility` 以 `semver.satisfies(runtimeVersion, peerRange,
  { includePrerelease: true })` 判定 profile bundle 自身、以及它 patch 插入的每一行；
  不满足就**跳过该 bundle / 禁用该行**。所以过期的 peer 范围现在的代价是「插件不加载」，
  而不是一条警告。注意判定方向是「运行版本是否落在 peer 范围内」，且 `includePrerelease`
  会解除 npm 的同 tuple 预发布限制——`^0.1.5-0` 在 `0.1.7-rc.1` 上同样返回 true，这正是
  旧声明能侥幸通过闸门的原因。
- `dsh.engines.dsh` **至今没有任何读取方**（DSH 源码与 market 中均未发现），只是前瞻声明；
  真正的执行点是上面的 peer 检查。两者必须在同一次发布里一起抬升，否则留下互相矛盾的元数据。

旧线怎么办：由冻结点在旧线的发布继续服务（npm 上旧版本仍在），修复只落当前线。

### 预发布与 `||` 并集

npm 的 prerelease 匹配规则是：带 prerelease 的版本，只有在同一个 `||` 分组里存在一个
「同名 major.minor.patch 且自身带 prerelease」的比较器时才可能被匹配。因此：

- 覆盖某个 tuple 的整段（含预发布）用 `^<tuple>-0`；要排除该 tuple 更早的预发布，
  就用 `^<tuple>-rc.N` 作下限（当前即 `^0.1.7-rc.1`，与 DSH 自己从 `rc` 起测的态度一致）。
- 若将来要重新覆盖多条线，**每个出过预发布的 tuple 各占一个 `||` 项**；
  `>=0.1.0-rc.6 <0.2.0` 这类写法会静默漏掉 0.1.0 之外所有 tuple 的预发布。
- DSH 转正式版后 prerelease 规则不再约束，可收敛为单一稳定范围（如 `^0.1.x`）。

### 版本监视

`node scripts/check-dsh-version.mjs` 读取 registry 的**全部 dist-tag**（不只是 `latest`），
取其中最高的 tuple 与 peer 覆盖范围比较：

- exit 0 = 没有比覆盖范围更高的 tuple（更低的不算问题：那是刻意抬高的下限）。
- exit 1 = 存在更高的 tuple，按提示核对新线并同步 peer / devDeps / `dsh.engines.dsh`。
- exit 2 = registry 不可达或不可解析（绝不当作 OK）。

**为什么必须看全部 tag**：DSH 把预发布放在各自 tag 下——`0.1.7-rc.1` 发布时 `latest`
仍是 `0.1.5-rc.3`，它只在 `next`（以及 `alpha`）之下。旧脚本只读 `latest`，所以 0.1.7
这条线从未被提醒，这正是本次适配的起因。

### 类型来源（devDependencies）

client 半面的编译期类型来自真实 harness 包：devDeps 按**精确版本**钉住，并把
「上游 `.d.ts` 引用到的包」全部声明（判据不是「我 import 了谁」，而是依赖包的公开
`.d.ts` 是否引用了它）。

- `.npmrc` 的 `legacy-peer-deps=true` 让 npm 不传递安装 peer，因此上游 `.d.ts`
  引用到的包必须由本包自己声明，否则 TS 解析不到。
- 危险在于**静默**：`skipLibCheck: true` 会把解析不到的类型变成 `any`，typecheck
  依旧全绿而每个真错误都被掩盖。因此 `src/client/contract.ts` 用类型级断言钉住所读
  形状（并把 `any` 本身判为失败）。改动依赖列表后要确认断言仍有牙齿——故意把某个
  断言反向，编译应当失败。

### 发布 dist-tag

0.1.7-rc.1 适配版发到 `next`，`latest` 暂留上一版：npm 上 `@deepseek-ai/dsh` 的
`latest` 仍是 `0.1.5-rc.3`，若把只支持 0.1.7 的构建推到 `latest`，0.1.5 用户更新后
会被启动 peer 检查跳过。`publish.yml` 新增 `dist_tag` 手动输入用于显式指定（预发布
版本默认按其标识符、稳定版本默认 `latest`；本次显式传 `next`），并且只有发到
`latest` 时才把 GitHub Release 标为 `--latest`。
