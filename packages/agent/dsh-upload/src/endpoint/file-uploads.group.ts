// `fileUploads` 组的**两端共用面**：组名、方法名与那次上传的请求/应答形状
// （与上游 `client/file-upload` 的描述符一致）。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧
// （`server/file-upload-endpoint.ts`）继承它实现方法。客户端形态不在本仓：这一组的客户端面由上游
// `@deepseek-ai/dsh-client-file-upload#fileUploads` 的 `$mount` 面提供。
import type {
  EncodedFileUploadRequest,
  FileUploadValue,
} from "@deepseek-ai/dsh-client-file-upload/types";
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

/**
 * `fileUploads` 组：一次编码上传。
 *
 * wire 上是**两个**命名参数——`agent`（descriptor 里是 lookup，wire 上放会话身份）与 `request`
 * （`{ data, name? }`，`data` 是 base64）。契约按位置声明这两项，宿主侧 `registerRemoteGroup`
 * 就按 `parameters` 的声明顺序逐个传参。应答是**裸值**（与上游 `@Remote` 同协议，失败即异常）。
 */
@RemoteGroup({ name: "fileUploads" })
export class FileUploadsEndpoint {
  /**
   * 上传一段编码后的字节，落成内容寻址的附件。
   * @param _agent - 会话身份（上游按它查 agent）。
   * @param _request - 编码后的文件内容与可选文件名。
   * @returns 暂存回执与落盘的附件引用。
   */
  @RemoteMethod({ parameters: ["agent", "request"] })
  async upload(_agent: string, _request: EncodedFileUploadRequest): Promise<FileUploadValue> {
    throw new Error("fileUploads/upload：契约类未实现（宿主侧要在子类里实现它）");
  }
}
