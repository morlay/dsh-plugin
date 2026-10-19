# `settings.json` 里的 llm provider 到不了 provider 行

状态：触发中（模型选择器可交互，但永远是「暂无可用模型」）

**现象**

`apps/dsh-custom-next/.dsh-store/settings.json` 里已经有 `llm-pi-ai.providers`（ollama / 小米等），但：

- 输入区模型选择器（`conversation.input.model`）能打开、状态已离开 loading，内容是**「暂无可用模型」**；
- `session/modelCatalog` 回 `{ default: {deepseek-official, deepseek-flash}, routableProviders: [], groups: [], failures: [] }`；
- 设置 → 模型页签能列出 provider，但字段只显示「其余字段在 cordis.patch.yml 中，请直接编辑对应段」，UI 里填不了 key。

**根因**

上游 llm provider 行（`llm-pi-ai` / `llm-deepseek*`）的用户配置读的是**上游 `ctx.settings`** 服务，而本装配的
settings 是自研文档（`packages/agent/dsh-setting` 的 `Setting` 契约 + `setting-endpoint`），没有上游
`settings` 服务 → 文档里的 provider 段不会走到 provider 行。另外 dev profile 没有 `.credentials.yaml`，
`deepseek-official` 的 `discoverModels` 回空，分组被过滤掉。

**影响**

模型选择器、设置里的模型页签、以及任何依赖 `session/modelCatalog` 的 UI 都只有空目录；`session/selectModel`
只能选装配面写死的默认模型。

**触发条件**

要在 UI 里真正选择模型（或让用户在设置里填 provider key）时。

**销账条件**

Done when：`settings.json` 的 `llm-*` 段能被 provider 行读到（装上游 `settings` 服务并把我们的文档接上，
或让 provider 行改读 `Setting` 契约），且在有凭据的环境下 `session/modelCatalog.groups` 非空。

**不修的理由**

这是一个「两套 settings 面怎么合」的架构决定（上游 `ctx.settings` 的 schema/密钥脱敏/分层 vs 我们的单份 JSON 文档），
不该塞进「模型选择器上屏」这一单；先把选择器的接线与投影修好（本轮已做），再单独决定桥接方向。
