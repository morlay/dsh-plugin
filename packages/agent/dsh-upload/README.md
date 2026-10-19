# @morlay/dsh-upload

浏览器文件上传的宿主面：上游 `FileUploads`（`fileUploads` 服务）的适配行。

## 用法

- 导出：`FileUploadStore` 契约（`registerAgentResolver` / `resolve` / `bindPrompt` / `retirePrompt`）与行 `FileUploadStoreDefault`。
- 装配：`UploadModule`。行依赖 `AgentDirectory` / `AttachmentStore` / `CommandRegistry` / `Connection` 四个服务。
- 消费方：`apps/dsh-custom-next` 的 `session-controller.row.ts` 把它作为上游 `SessionController` 的 `fileUploads` 依赖交出。

## 设计

上游 `FileUploads` 已经是完整服务（HTTP 上传路由、命令回执解析器、会话事件观察都在它自己的构造里），本包只做行，不重新实现。契约面的语义照上游：解析器是**单槽**，重复登记直接抛错。

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
