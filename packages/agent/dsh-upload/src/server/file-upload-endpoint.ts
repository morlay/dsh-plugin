// `fileUploads` 组的**宿主实现**（wire 端点）：继承 `endpoint/` 的契约类，转发到上游 `FileUploads`。
//
// 上游 client（`ui-conversation` 的上传运行时）对 `Uint8Array` 走 **remote** 这条路：
// `remote.fileUploads.upload(sessionId, { data: base64, name? }, signal)`——descriptor 的第一个参数名是
// `agent`（lookup，wire 上放的是 `SessionId`），第二个是 `request`。
// 宿主这边落到上游 `FileUploads.upload(agent, request, signal)`：本包的 `FileUploadStoreDefault` 已经把
// 上游实例挂上来了，这里只做「会话 → agent」的解析与结果的转发。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`），这里不出现 `"fileUploads/upload"` 这种字符串。
import type {
  EncodedFileUploadRequest,
  FileUploadValue,
} from "@deepseek-ai/dsh-client-file-upload/types";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import { inject, Injectable, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { FileUploadStore } from "../contract/file-upload-store.contract.ts";
import { FileUploadsEndpoint } from "../endpoint/index.ts";

/** `fileUploads` 组的宿主实现。 */
@RemoteGroup()
@Injectable()
export class FileUploadEndpointRow extends FileUploadsEndpoint implements OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  private readonly uploads = inject(FileUploadStore);

  private readonly agents = inject(AgentDirectory);

  private readonly disposers: (() => void)[] = [];

  onInit(): void {
    this.disposers.push(registerRemoteGroup(this.handlers, this));
  }

  /**
   * 一次编码上传：解析接收方 agent，交给上游 `upload`（它落附件并暂存回执）。
   * @param agent - wire 上的会话身份。
   * @param request - `{ data, name? }`（`data` 是 base64；校验在上游的 zod codec 里）。
   * @returns 暂存回执与落盘的附件引用。
   */
  override async upload(
    agent: string,
    request: EncodedFileUploadRequest,
  ): Promise<FileUploadValue> {
    const found = this.agents.get(SessionId(agent));
    if (found === undefined) throw new Error(`fileUploads/upload: 会话 "${agent}" 没有 agent`);
    // 裸值协议（与上游 `@Remote` 一致）：失败是异常，不再包 `{ ok, value }`。
    return await this.uploads.upload(found, request, new AbortController().signal);
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
