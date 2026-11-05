// upload 域的**浏览器半**（`@morlay/dsh-upload/ui`）：附件上传运行时（`ctx.fileUpload`）。
//
// 上游 `@deepseek-ai/dsh-client-file-upload` 的 client 半归本域；会话界面的输入区从这里取这一行装配。
export { FileUpload } from "./file-upload.token.ts";
export { FileUploadRuntime } from "./file-upload-runtime.ts";
export { provideFileUploadUi } from "./file-upload.provide.ts";
