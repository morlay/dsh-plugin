// `ctx.fileUpload` 的跨行令牌：附件上传运行时（upload 域的 `FileUploadRuntime` 提供它，
// 会话界面的输入区按它取）。令牌归 upload 域——服务是谁提供的，令牌就是谁的。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.fileUpload`（附件上传运行时：队列、上传控制面）。 */
export const FileUpload = new InjectionToken<unknown>("fileUpload");
