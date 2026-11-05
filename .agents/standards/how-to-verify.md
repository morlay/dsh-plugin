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
  收集规则在 [`vitest.config.ts`](../../vitest.config.ts)：`**/__tests__/**/*.spec.ts(x)`，
  排除 `node_modules` / `target` / `_packages`。
- **单测等待上限 3s**：`testTimeout: 3000`（同上）。要更长预算的用例显式给 `{ timeout }`——那是承认成本，
  不是放宽断言（跨域装配的包内用例给 180s 一类的显式预算，见能力层规范）。
- **等条件，不等时间**：渲染 / 装配类断言用 `vi.waitFor(条件, { timeout })`，不写
  `await new Promise((r) => setTimeout(r, 50))` 等状态。唯一允许的定时器是 `dispose` 的兜底
  （`Promise.race` 里 10s 收尾），它不是断言。
- **浏览器半用例加文件头** `// @vitest-environment happy-dom`，并在 `afterEach` 里 `cleanup`（vitest 未开
  globals，`@testing-library/react` 不自动清理）。
- **测试辅助跟着域走**：跨包复用的替身放该包的 testing 面——框架侧是
  [`@morlay/zephyr-app/testing`](../../packages/zephyr/zephyr-app/src/testing/index.ts)（`FakeAppEnv` /
  `tempDataDir` / `cleanupDataDirs` / `mountFullApp`）与
  [`@morlay/zephyr/testing`](../../packages/zephyr/zephyr/src/testing/index.ts)；下游从这里取，不再造第二份。
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

- **发布走 CI，本地不发布**：`just publish` 只打印红线并退出 1；CI 是
  [`.github/workflows/release.yml`](../../.github/workflows/release.yml)，`main` / `next` 推送触发。
- **`check` job 是唯一的质量门**：`just prepare` → `just lint` → `just test`（注入 `TEST_PG_URL`）→
  `just build`。这四条与本地判据同一套命令。
- **bump 前确认版本号没被占用**：撞上已占用的号时表现为「提交了、包没更新」——改版本前先
  `pnpm view <pkg>@<新版本> version` 确认，或跳到未占用的号段。

## 失败怎么处理

- 相关检查失败就停下修掉，或说清阻塞点；不要推着「CI 可能会过」往下走。
- 像环境问题的，先证明：记下确切命令、失败用例、平台差异，再判断是环境还是回归。
- 不要为了过验收放宽检查（降阈值、跳过用例、缩覆盖），也不要改断言迁就实现。
- **调试探针当轮删掉**：页面里的 `console.debug`、入口里的验证调用、只为这次验证加的临时代码，改动完成即删。
  判据：`git diff` 里没有「只为这一次验证」的代码。
- **日常验证不起真服务**：`just custom dev` / `preview` 绑端口、装依赖，卡住的是验证本身。装配链回归用
  `just custom build` 的产物与各包行为用例覆盖。
