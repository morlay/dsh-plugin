# @morlay/dsh-upload

浏览器文件上传的宿主面：上游 `FileUploads`（`fileUploads` 服务）的适配行。

## 用法

- 导出：`FileUploadStore` 契约（`registerAgentResolver` / `resolve` / `bindPrompt` / `retirePrompt`）与行 `FileUploadStoreDefault`。
- 装配函数：`provideUpload()`（`./server`）。行的 `deps`：`AgentDirectory` / `AttachmentStore` / `CommandRegistry` / `Connection`。
- 本包不拥有装配清单，也不登记谁消费这一行（上层装配面负责）。

## 设计

上游 `FileUploads` 已经是完整服务（HTTP 上传路由、命令回执解析器、会话事件观察都在它自己的构造里），本包只做行，不重新实现。契约面的语义照上游：解析器是**单槽**，重复登记直接抛错。

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
