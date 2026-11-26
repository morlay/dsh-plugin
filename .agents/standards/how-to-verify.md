# 如何验证

「验证过」= 有**最小充分**的证据，并且贴出真实输出。命令入口在根 [`justfile`](../../justfile)（`just --list`），
版本见 [`mise.toml`](../../mise.toml)。判据不够时补证据，不靠"应该没问题"。

## 证据矩阵

按改动落在哪选证据，够用就好——不要反射式跑全量。

**门禁 = 包级 vitest + `just audit` + `just lint` + `just build`**；组装起来能不能跑，用 `just custom build` 与清单评审看，**`apps/*` 不设测试门禁**（判据下沉到能力层与扩展包的 `__tests__`）。

| 改动                        | 至少跑                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 单包源码                    | `pnpm exec vitest run packages/<family>/<pkg>/src`；接缝见该包 `.agents/standards/`                                  |
| 跨包契约 / 公共类型面       | 涉及包的测试 + `just test`                                                                                           |
| 面边界 / 依赖清单           | `just audit`（逐包跑、根上汇总；`--write` 删未用依赖）                                                               |
| 浏览器半（client 渲染）     | 该包 ui 面的 `__tests__`；整装渲染不是门禁，见[真装配与端到端](./how-to-e2e.md)                                      |
| 装配清单 / 组装（`apps/*`） | `just custom build`（能构建）+ 清单可读性（评审）；apps 不设测试门禁                                                 |
| 构建 / 出口 / 发布产物      | `just build`                                                                                                         |
| 类型与规则                  | `just lint`                                                                                                          |
| 文档与记录                  | 相对链接可达；行内代码里的路径存在（`grep` 或 `ls` 一次）                                                            |
| vendor 上游（同步 / patch） | `just test` + `just lint` + `just build`；同步步骤见 [zephyr-upstream-sync](../skills/zephyr-upstream-sync/SKILL.md) |

## 测试落点

- **位置**：判据住在被测包——`packages/<family>/<pkg>/src/__tests__/`；浏览器半的用例住 ui 面各目录的
  `__tests__/`（框架 zephyr-app 的 client 面另有自己的 `__tests__`）。**判据只下沉到能力层与扩展包**：
  `apps/*` 里没有必须绿的用例，那里的 spec 是自检（`just test` 会按收集规则收到，但它不是门禁）。
  收集规则在 [`vitest.config.ts`](../../vitest.config.ts)：两层 project——`*.spec.dom.ts` / `*.spec.dom.tsx`
  走 `ui`（`happy-dom`），其余 `*.spec.ts` 走 `node`；排除 `node_modules` / `target` / `.scratch`。
- **单测等待上限 3s**：`testTimeout: 3000`（同上）。要更长预算的用例显式给 `{ timeout }`——那是承认成本，
  不是放宽断言（跨域装配的包内用例给 180s 一类的显式预算，见能力层规范）。
- **弱证据不能替代强判据**：两次教训都出在这里，写法记一下——
  - 「`rg` 零命中」**不是**「没有消费方」：上游内部调用链靠类型与运行时连接，静态文本搜不到。
    `session` 组就据此漏掉过 5 个端点（`observeEvent` / `observeProjections` / `observeState` / `state` / `wait`）。
    判据是「**上游 wire 面里有的端点，我们全都要有**」，不是「我们搜到的调用点都要有」。
  - 「`implements` 通过」**不是**「对齐了」：形参在参数位置是逆变的，放宽永远合法（`readonly unknown[]`
    收得下 `readonly Attachment[]`）。wire 面的判据是形参与返回**双向**可赋值（`AssertWireFace`）。
  两条都是同一类错误：用一个更容易过的东西冒充真正的判据。
- **等条件，不等时间**：渲染 / 装配类断言用 `vi.waitFor(条件, { timeout })`，不写
  `await new Promise((r) => setTimeout(r, 50))` 等状态。唯一允许的定时器是 `dispose` 的兜底
  （`Promise.race` 里 10s 收尾），它不是断言。
- **fake timers 只伪造得了 JS 的时间**：`setTimeout` 重试 / 防抖 / 轮询可以用 `vi.useFakeTimers()` + `advanceTimersByTime`；
  **真 IO、内核锁等待（sqlite 的 `SQLITE_BUSY` / `busy_timeout`）、跨进程等待一律不能**——`advanceTimersByTime`
  与内核的重试毫无关系，用了只会让用例「看起来在等、其实什么都没测」。这类判据的形态是**「等到结果 + 证明等过」**：
  `expect(result.ok).toBe(true)` + `expect(result.waitedMs).toBeGreaterThan(0)`，**不写具体时长**——
  `>= 400` 那种数把「holder 持锁 800ms 减抖动」写成了契约，负载一抖就红（实测 391 vs 400）。
- **测试分两层，环境由文件名声明**：需要 DOM 的用 `*.spec.dom.ts`（渲 React 组件的用 `*.spec.dom.tsx`），
  其余 `*.spec.ts` 走 node。**不写 `// @vitest-environment` 文件头**，也不靠目录或裸 `.tsx` 推断——
  环境由 `vitest.config.ts` 的 project 按文件名给。`cleanup` 由该包 `test` 的 auto fixture 负责（见下一节）。
- **严禁 vitest 的老旧钩子**：`beforeAll` / `afterAll` / `beforeEach` / `afterEach` 一律不许出现在 spec 里，
  也不许模块级可变状态（`let root`、`const apps = []`）。环境准备与清理一律做成 fixture：
  - 每个测试都要的那份 → 包级 `test` 上 `test.extend` 一个 `{ auto: true }` 的 fixture（`cleanup`、
    `vi.unstubAllEnvs`、关 server 都是这一类），**import 哪份 `test` 就带哪份清理**，从 import 行读得出来；
  - 每个测试配置不同的那份 → 普通 fixture，spec 签名里 `async ({ appEnv }) =>` 显式取；
  - 文件级共享装配 → 测试内 `await bootTwoSided(...)`（自动 `dispose`），不再 `beforeAll` 起一次。
    **不用全局 `setupFiles`**：那与 `beforeAll` 是同一类隐式状态。也不用配置项替代（`unstubEnvs` 等），
    恢复逻辑归 fixture。
- **测试入口只有一个**：spec 从 `@morlay/zephyr/testing`（或包级扩展的那份 `test`）取 `describe` / `test` / `expect`，
  不直接 `import ... from "vitest"`。
- **测试辅助只有两种形态，都在 testing 面**：
  - **fixture**：`@morlay/zephyr-app/testing` 的 `appEnv`（指向临时目录的 `AppEnv` 替身，结束自动删）；
    包级 `test` 上的 `auto: true` fixture（清理类）；
  - **装配函数**：`bootTwoSided({ createHost, createClient? })`（自动 `dispose`）、`clientWithTransport`、
    `hostInvokerOf`、`LocalRemote`。
    跨包复用的替身跟着域走，不造第二份。
- **判「域行为」的进包，「组合」不靠 `apps` 用例**：端点的入参/返回值、域内装配用本包的最小清单；
  「这份清单组合起来对不对」（替换面唯一、模型面、位置台账）由 `just custom build` 加清单评审看，
  不再要求 `apps` 里写用例。
- **测试描述行为，不描述实现**：行为变更必须连同测试一起改；只经公开使用面断言（包出口 + 契约令牌），
  越过接口去测说明接口形状不对（见 [`how-to-write.md`](./how-to-write.md)）。

## 环境依赖的用例

- **必须门控，且门控有原因**：默认套件里 `skip`、不给假绿；触发方式写在该包 `.agents/standards/`。
  当前两处：

  | 用例                                                                                   | 门控                                    | 没满足时          |
  | -------------------------------------------------------------------------------------- | --------------------------------------- | ----------------- |
  | [zephyr-rdb 的 pg 用法用例](../../packages/zephyr/zephyr-rdb/src/__tests__/pg.spec.ts) | `TEST_PG_URL`（CI 的 `check` job 注入） | `describe.skipIf` |
  | 会话状态类用例（`DSH_HOME`）                                                           | 用 `tempDataDir` 指到临时目录           | 不依赖本机数据    |

- **真机行为另开一条门控，但没有默认 spec**：要验时新写一条 `*.e2e.spec.ts` 并自带门控
  （`TEST_SEATBELT=1` + macOS + `sandbox-exec` 探针），属人工门、不是门禁。内核 / 平台差异
  （Seatbelt、bwrap、Landlock）在默认套件里只测「我们生成了什么」（假执行器记录 argv），真机是否照做
  放在那条门控里。判据：同一行为的参数断言与内核断言是两条用例。
- **起本地 Postgres**：`just -f packages/zephyr/zephyr-rdb/tool/pg/justfile test`（先起 compose，宿主端口
  25433）。日常验证不跑它：它绑端口、起容器，会被机器上其它进程挡住。
- **固定端口要写 `PORT=0`**：包内用例需要起宿主时由内核给端口，不占固定端口。

## 交付与发布

- **发布线（集合、形态、版本、通道、验收）的 home 是[设计 npm 发布线](../designs/20261118-npm发布线.md)**；这里只写验证入口。
- **三条通道**：GitHub Packages 只走 CI——[`.github/workflows/release.yml`](../../.github/workflows/release.yml) 在
  `main` / `next` 推送时自动发未发布的新版本；npmjs 只经本地 `just publish-npm`（[ADR-npmjs 发布走本地命令](../adrs/20261118-npmjs发布走本地命令.md)）。其他形式的 `pnpm publish` 一律禁止。
- **本地模拟 registry 是默认地址**：`just publish-npm` 不带 `--registry` 时发到
  [`tool/npr`](../../tool/npr/README.md) 的 verdaccio（`http://127.0.0.1:7677/`）——手滑跑一条只会发到本机。
  **真发 npmjs 必须显式写地址**：`just publish-npm --registry https://registry.npmjs.org/`。
  演练：`docker compose -f tool/npr/compose.yml up -d` → `just publish-npm --dry-run` → `just publish-npm`；
  同名同版本换内容用 `--force-republish`（`unpublish --force` 再 `publish`，只对 loopback registry 开放，
  真 registry 上那是真删除）。
- **registry 由 scope 映射兜底**：[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) 的 `registries` 把
  `@morlay` 指向本地；scope 级映射会盖掉命令行 `--registry`，所以 `publish.ts` 逐次用
  `--config.@morlay:registry=<url>` 覆盖。加通道或换地址时先确认这一条没被绕过。
- **发布前先构建**：`just build`（清单、产物与声明树都在这一步；声明树不由人工先跑 `just dts`）；
  每个发布包的 `prepublishOnly` 也会在 `pnpm publish` 前再跑一次 `devkit build`，不会发出旧产物；
  发布顺序由 pnpm 按 workspace 的依赖图排（串行），不用人工指定先后。
  `just publish-npm --dry-run` 先看包名、版本与 dist-tag。
- **发布前验收的 registry**：`just verify-release` 的真装默认从本地模拟 registry 解析依赖（判据 9）；
  真发 npmjs 前用 `just verify-release --registry https://registry.npmjs.org/` 再验一次。
- **`check` job 是唯一的质量门**：`just prepare` → `just lint` → `just test`（注入 `TEST_PG_URL`）→
  `just build`。这四条与本地判据同一套命令。
- **dist-tag 随版本号走**：稳定版 → `latest`；`-alpha.*` → `alpha`；其余预发布 → `next`；预发布绝不落 `latest`。
- **bump 前确认版本号没被占用**：撞上已占用的号时表现为「提交了、包没更新」——改版本前先
  `pnpm view <pkg>@<新版本> version` 确认，或跳到未占用的号段。
- **`@local/*` 不发布**：`devpackages/**` 全部 `private`，构建时内联进产物，发布清单里不出现它们。

## 失败怎么处理

- 相关检查失败就停下修掉，或说清阻塞点；不要推着「CI 可能会过」往下走。
- 像环境问题的，先证明：记下确切命令、失败用例、平台差异，再判断是环境还是回归。
- 不要为了过验收放宽检查（降阈值、跳过用例、缩覆盖），也不要改断言迁就实现。
- **调试探针当轮删掉**：页面里的 `console.debug`、入口里的验证调用、只为这次验证加的临时代码，改动完成即删。
  判据：`git diff` 里没有「只为这一次验证」的代码。
- **日常验证不起真服务**：`just custom dev` / `preview` 绑端口、装依赖，卡住的是验证本身。装配链回归用
  `just custom build` 的产物与各包行为用例覆盖。
