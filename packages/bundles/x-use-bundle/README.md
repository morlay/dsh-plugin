# @morlay/x-use-bundle

[![NPM Version](https://img.shields.io/npm/v/%2540morlay%252Fx-use-bundle)](https://www.npmjs.com/package/@morlay/x-use-bundle)
[![NPM Downloads](https://img.shields.io/npm/dw/%40morlay%2Fx-use-bundle)](https://www.npmjs.com/package/@morlay/x-use-bundle)

通用 MCP 接法的一次装齐：两条 `dsh-mcp-client` 行分别以 stdio 起 `agent-browser mcp` 与
`agent-desktop mcp`，工具以 `mcp__agent-browser__*` / `mcp__agent-desktop__*` 进入模型目录。

| 装什么                 | 数据从哪来                |
| ---------------------- | ------------------------- |
| `mcp-agent-browser` 行 | 本包的 `tsdown.config.ts` |
| `mcp-agent-desktop` 行 | 本包的 `tsdown.config.ts` |

## 用法

把包名加进 profile 的 `dsh.profile.bundles`，或在插件页启用。前提只有一条：对应的 bin 在宿主的 `PATH` 里
（`agent-browser` / `agent-desktop`）。**没装就是没有这组工具**：两行都用 MCP 客户端默认的
`failOnStartupError: false`，命令找不到时该行照常激活、只是不产出工具，宿主其余部分不受影响。

两条都是**宿主级**挂载：一个 server 进程、所有会话共用同一个浏览器 / 桌面会话（page、tab、前台窗口会互相
看见）。要每会话独立 Chromium 或把已有浏览器独占给一个会话，用 `browser-use` + 提供方那一套。

要在打包形态里补 PATH（例如 mise 的 shim 不在 GUI 启动的环境里），用宿主侧的启动环境处理，而不是在本包钉
绝对路径。要改 `agent-browser mcp` / `agent-desktop mcp` 的参数（`--tools`、`--session`、`--headed`），在
profile 的覆盖层里改对应行的 `config.args`；MCP 客户端字段见上游
[`dsh-mcp-client`](../../../vendor/deepseek-harness/packages/mcp/mcp-client/README.zh.md)。

## 链接

- [MCP 客户端](../../../vendor/deepseek-harness/packages/mcp/mcp-client/README.zh.md)：服务器配置、工具命名与限制。
- [MCP 资源](../../../vendor/deepseek-harness/packages/mcp/mcp-resources/README.zh.md)：随附 profile 提供的资源发现与读取。
- [浏览器操作子系统](../../../vendor/deepseek-harness/docs/subsystems/browser-use.zh.md)：需要会话级隔离时的提供方接法。

**插件页不挂长文**：`locale/*.json` 的 `meta.detail` 指向空文件 [`docs/detail.md`](./docs/detail.md)；本 README 仍是包门面。
