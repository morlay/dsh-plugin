// `ctx.fileUpload` 契约（浏览器侧）：上游 `file-upload` client 半的上传服务面。
//
// 成员来自上游 `FileUploadService`：会话界面的输入区把它交给上游 `ConversationController` 的上传队列
// （粘贴/拖入的图片走 `uploadImage`，普通文件走 `upload`）。实现是 `FileUploadRuntime`
// （`fromCordis` 照装上游 client 半，契约面就是它发布的服务）。
//
// 契约类而不是值令牌：`inject(FileUpload)` 拿到的是**有方法的服务**，装配期缺提供者会当场报错
// （值令牌会被"上游 mount 期按名字发布"放过，坏在这一步是静默的——粘贴无反应正是这么来的）。
import type { FileUploadService } from "@deepseek-ai/dsh-client-file-upload/client";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/** 覆盖守卫：上游 `FileUploadService` 有而契约没列出的成员，编译期必须为空。 */
export type FileUploadCovered = AssertTrue<AssertCovered<FileUploadService, FileUpload>>;

/** `ctx.fileUpload`：按会话身份暂存上传的服务。 */
@Injectable()
export abstract class FileUpload {
  abstract readonly upload: FileUploadService["upload"];

  abstract readonly uploadImage: FileUploadService["uploadImage"];
}
