# @morlay/dsh-attachment

附件存储后端：会话里的图片与文件在此落盘、回读，存储根跟随 DSH_HOME 与配置。

## 用法

- 导出：`Attachments` 契约（上游 `attachments` 服务的令牌）与 `AttachmentsDefault`。
- 装配：`AttachmentModule`，配置项 `dshHome` 省略时按上游顺序回落。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
