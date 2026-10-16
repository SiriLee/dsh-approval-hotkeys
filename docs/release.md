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
`latest`）。**本次 0.2.0 走 `latest`**，见下文「发布 dist-tag」。

## DSH 版本对齐（peer 范围）

### 当前策略：一次发布对一条 DSH 线，窗口带两端

```
dsh.engines.dsh                          >=0.2.0-rc.2 <0.3.0-0
@deepseek-ai/dsh-api-session-controller  ^0.2.0-rc.2
@deepseek-ai/dsh-client-ui-session       ^0.2.0-rc.2
```

- **`engines.dsh` 存在时独占判定**：DSH 0.2.x 的 `@deepseek-ai/dsh-app-boot`
  `plugin-compatibility.ts` 先看 `engines.dsh`，有它就只看它，`peerDependencies` 全部忽略。
  判定式为 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，
  不满足则**跳过该 bundle / 禁用该行**。0.1.7 时代执行点是 peers、`engines.dsh` 无人读取——
  这一点已经反转，是 0.2.0 之后最重要的一条元数据事实。
- **上界不能省**：没有 `<X.Y.0-0` 时，下一条线的第一个预发布当天就会被自动准入，而它的
  客户端契约没人核对过——0.2.x 这次就是这样错过的。`verify-host` 会强制窗口带上下界。
- 下界拒绝旧线；旧线由冻结点在旧线的发布继续服务。
- harness 会在**同一条线内**删客户端 API 且不给 shim（`SessionListState.current`、
  `uiSession.pendingInteractions`），所以窗口只在**两端都核实过**之后才写（本版：
  `0.2.0-rc.2` 与 `0.2.1-alpha.5`，声明/DOM 面实测一致）。

### 范围的写法

- 覆盖某个 tuple 的整段（含预发布）用 `^<tuple>-0`；要排除该 tuple 更早的预发布，就用
  `^<tuple>-rc.N` / `^<tuple>-alpha.N` 作下界（当前 `^0.2.0-rc.2`）。
- 上界习惯写成 `<下一 tuple>.0-0`，把该 tuple 的所有预发布一并挡住。
- 需要重新覆盖多条线时，每个出过预发布的 tuple 各占一个 `||` 项。

### 版本监视

`node scripts/check-dsh-version.mjs` 读取 registry 的**全部 dist-tag**，判断有没有已发布
版本落在声明窗口之外：

- exit 0 = 全部在窗口内；exit 1 = 有落在窗口外的，按提示核实新线并整体移动窗口与 pins；
  exit 2 = registry 不可达或窗口不可用。
- **为什么必须看全部 tag**：DSH 把预发布放在各自 tag 下——0.1.7-rc.1 在 `next` 而 `latest`
  还是 0.1.5-rc.3；今天 `latest`/`next` 是 0.2.0-rc.2、`alpha` 是 0.2.1-alpha.5。旧脚本只读
  `latest`，这正是 0.1.7 那次没被提醒的原因。

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

本版发到 **`latest`**：npm 上 `@deepseek-ai/dsh` 的 `latest`/`next` 是 `0.2.0-rc.2`，
而本插件窗口 `>=0.2.0-rc.2 <0.3.0-0` 覆盖它，所以 `latest` 用户更新后会被正常准入，
不存在「装上却不加载」。推 `v0.2.0` tag 即可：tag 触发时按版本推导 dist-tag，
稳定版本推导出 `latest`。`publish.yml` 的 `dist_tag` 手动输入仍可用于显式指定，
只有发到 `latest` 时才把 GitHub Release 标为 `--latest`。
