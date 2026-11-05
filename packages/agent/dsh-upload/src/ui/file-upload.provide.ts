// upload 域的**浏览器半装配**：附件上传运行时。
//
// 这一行要 `remote`（挂 `FILE_UPLOAD_REMOTE` 描述符）与会话界面的输入区就位，装配面把它排在
// `provideSessionInputSlots()` 之后。
import { provide, type ProviderList } from "@morlay/zephyr";
import { FileUploadRuntime } from "./file-upload-runtime.ts";

/**
 * 附件上传的行清单。
 * @returns provider 清单。
 */
export function provideFileUploadUi(): ProviderList {
  return provide([FileUploadRuntime])();
}
