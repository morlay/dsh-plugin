# @morlay/dsh-skill

技能注册表与文件系统技能来源：把「技能」变成可被发现、可注入目录的一等对象。

## 用法

- 导出：`Skill` 契约与 `SkillDefault`（注册表）、`SkillFilesystem`（文件系统来源）、`ToolSkill`（`skill` 工具行）。
- 装配：`SkillModule`（注册表 + `skill` 工具行）与 `SkillFilesystemModule`（文件系统来源）。
- 浏览器半：`@morlay/dsh-skill/ui` 的 `SkillSlots`（输入区 `/` 的技能源、会话里的技能行、右侧技能面板）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
