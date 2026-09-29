# DSH Plugin(s)

DeepSeek Harness Plugin 自用开发插件集合：`@deepseek-ai/*` 只读，扩展只走 cordis 插件层（plugin / patch bundle / settings namespace）。

一个工作区 profile = `dsh.profile.bundles` 顺序应用的一串 bundle patch；每个 bundle 聚合一个领域——行清单与它要的配置值住在同一个包里，能力包只发布实现与 `rows` 出口。布局与装配的 home 是[系统设计](.agents/designs/20260917-系统设计.md)，上下文边界与术语归属见[上下文地图](.agents/CONTEXT-MAP.md)。

## 包

装配入口是 `bundles/` 的五个 bundle；能力包（`packages/<family>/<pkg>`，family 只是目录分组）由它们展开，各包的门面与用法在它自己的 `README.md`：

[better-session](packages/bundles/better-session/README.md) · [session-mode-profile](packages/bundles/session-mode-profile/README.md) · [sandbox-profile](packages/bundles/sandbox-profile/README.md) · [ollama-provider-profile](packages/bundles/ollama-provider-profile/README.md) · [mydsh-profile](packages/bundles/mydsh-profile/README.md)

非发布部分：示例工作区 [`apps/dsh-custom-next`](apps/dsh-custom-next/justfile)（装配声明在这里）、共享开发配置 [`devpackages/devkit`](devpackages/devkit/tsconfig.json)、上游 side workspace [`vendor/`](.agents/skills/dsh-plugin-upstream-sync/SKILL.md)。

agent 工作指引见 [AGENTS.md](AGENTS.md)，记录树的布局与命名见 [`.agents/README.md`](.agents/README.md)；命令与版本见 [justfile](justfile) / [mise.toml](mise.toml)。
