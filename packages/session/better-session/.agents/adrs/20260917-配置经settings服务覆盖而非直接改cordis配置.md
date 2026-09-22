# 配置经 settings 服务覆盖而非直接改 cordis 配置

状态：已被 ADR-跟随上游session-format-v4 取代（上游 0.1.7 取消了 settings namespace 覆盖插件 config 的能力：
settings 现在只投影 volatile 字段做表单编辑，改动持久化回 profile patch 的 entry config）

> **2026-09-22 更新**：本篇描述的机制在上游 0.1.7 已不存在（`SettingsProvider` /
> `installSection` / namespace section 全被移除），`session-rdb` 与
> `llm-openai-compatible` 都不再注入 `settings` 服务。新的配置来源是行 config
> （bundle patch / profile patch / 设置页），旧 `settings.yaml` 由上游启动时一次性导入到同 id 的行。
> 决策见 [ADR-跟随上游session-format-v4](../../../session-rdb/.agents/adrs/20260922-跟随上游session-format-v4.md)。

`session-rdb` 的配置（SQLite / PostgreSQL 选择、路径、连接串等）经
`$DSH_HOME/settings.yaml` 的 `session-rdb` namespace 覆盖 cordis 层 entry
config（注册于 `ctx.settings`，见 `SessionPersistenceRdb.settingsNs`），
未写出的字段回落到 bundle patch / cordis.yml 的 config 默认值。字段清单、
默认路径与示例见 [README](../../README.md)。

## 考虑过的选项

- **直接改 cordis.patch.yml 的 config**：bundle patch 是代码的一部分，
  用户改配置即改代码，升级会被覆盖。
- **环境变量**：无类型、无结构，多字段配置（type / path / journalMode /
  busyTimeout / connectionString）难以表达。

## 后果

- settings.yaml 是纯 YAML（settings-local 用 `yaml` 库解析），**不支持
  `!!js` JS 表达式**——`!!js dshHomePath(...)` 会被当作字面字符串；`!!js`
  只在 `cordis.patch.yml`（bundle patch 层，loader 求值）有效。
