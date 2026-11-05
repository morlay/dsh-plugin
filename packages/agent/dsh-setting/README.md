# @morlay/dsh-setting

LLM provider 的配置行（pi-ai、DeepSeek API key、API 扩展注册表）与设置面板的浏览器半：装起来就生效。

## 用法

- 导出：`DeepseekLlmApiExtensions` 契约与 `LlmPiAi` / `LlmDeepseek` / `DeepseekLlmApiExtensionsDefault` 三行；浏览器半在 `@morlay/dsh-setting/ui`。
- 浏览器半的行：`SettingsHost` / `SettingsGeneralSlots` / `SettingsModelsSlots`（设置面板），`ModelSelectionSlots`（输入框旁的模型选择器，上游 `ui-model-selection` 的 client 半；它**还要求 `commandUi` 有提供者**才起得来——见该文件头的说明）。
- 装配：本包没有 `Module`：host 行与浏览器半的设置面板行都由装配面直接列清单。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
