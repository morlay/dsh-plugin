# DSH Plugin(s)

DeepSeek Harness 的插件工作区：上游 `@deepseek-ai/*` 只读，扩展只走 cordis 插件层（plugin / settings namespace / 本地 patch），
不改上游源码。

设计与落点：[系统设计](.agents/designs/20260917-系统设计.md)（沿它的层索引进到各层设计）；术语归属：[定义权地图](.agents/GLOSSARY-MAP.md)；
记录树与技能清单：[`.agents/README.md`](.agents/README.md)。

## 结构

| 目录                         | 是什么                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/zephyr/*`          | 框架层：`zephyr`（cordis 的强类型 DSL）、`zephyr-app`（宿主 + 浏览器框架）、`zephyr-cli`（启动器）、`zephyr-ui`、`zephyr-rdb` |
| `packages/agent/*`           | 能力层：每个域一个包，四块职能（`contract` / `endpoint` / `server` / `ui`），另有 BFF `dsh-conversation`                      |
| `packages/agent-ex/*`        | 扩展层：替换默认实现或追加能力（`better-session` / `session-mode` / `configurable-sandbox` / `agent-use`）                    |
| `packages/zephyr-desktop/*`  | 桌面：Electron 壳与往命令树追加 `desktop dev` / `desktop bundle` 的插件                                                       |
| `packages/boot/dsh-oxc-node` | 全仓唯一的 TS loader 入口（module hooks，ESM only）                                                                           |
| `apps/zephyr-custom/`        | 示例工作区：provider 清单与 `zephyr.config.ts`（装配面）                                                                      |
| `devpackages/*`              | 本地工具（不发布）：audit / dts-prepare / typert-generator / tsdown-plugin-cordis                                             |
| `vendor/deepseek-harness/`   | 上游 side workspace：按 `DEEPSEEK_HARNESS_VERSION` 锁定的只读源码副本                                                         |

各包的门面与用法在它自己的 `README.md`。本仓库只有四个包没有标 `private`（`@morlay/zephyr`、`@morlay/zephyr-rdb`、
`@morlay/zephyr-desktop-shell`、`@morlay/dsh-oxc-node`），其余为 private、不发布；发布一律走 CI（见 [`AGENTS.md`](AGENTS.md)）。

## 命令

常用入口见 [`justfile`](justfile)（`just --list`）：`just test` / `just lint` / `just build` / `just audit`；组装验证 `just custom build`；
上游同步与版本见 [`mise.toml`](mise.toml) 与 [`zephyr-upstream-sync`](.agents/skills/zephyr-upstream-sync/SKILL.md)。

agent 工作指引见 [AGENTS.md](AGENTS.md)，记录树的布局与命名见 [`.agents/README.md`](.agents/README.md)。
