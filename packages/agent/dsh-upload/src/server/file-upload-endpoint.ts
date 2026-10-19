// `fileUploads/upload` 的 wire 端点（宿主侧）。
//
// 上游 client（`ui-conversation` 的上传运行时）对 `Uint8Array` 走 **remote** 这条路：
// `remote.fileUploads.upload(sessionId, { data: base64, name? }, signal)`——descriptor 的第一个参数名是
// `agent`（lookup，wire 上放的是 `SessionId`），第二个是 `request`。
// 宿主这边落到上游 `FileUploads.upload(agent, request, signal)`：本包的 `FileUploadStoreDefault` 已经把
// 上游实例挂上来了，这里只做「会话 → agent」的解析与 wire 结果的封装。
import type {
  EncodedFileUploadRequest,
  FileUploadValue,
} from "@deepseek-ai/dsh-client-file-upload/types";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { AgentDirectory } from "@morlay/dsh-agent";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { asRemoteResult } from "@morlay/zephyr-app";
import { FileUploadStore } from "../contract/file-upload-store.contract.ts";

@Injectable()
export class FileUploadEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly uploads = inject(FileUploadStore);

  private readonly agents = inject(AgentDirectory);

  onInit(): void {
    this.handlers.register("fileUploads/upload", async (args) =>
      asRemoteResult(() => this.upload(args)),
    );
  }

  /**
   * 一次编码上传：解析接收方 agent，交给上游 `upload`（它落附件并暂存回执）。
   * @param args - wire 命名参数（`agent` 是会话身份，`request` 是 `{ data, name? }`）。
   * @returns 暂存回执与落盘的附件引用。
   */
  private async upload(args: Readonly<Record<string, unknown>>): Promise<FileUploadValue> {
    const agent = this.agents.get(SessionId(String(args.agent)));
    if (agent === undefined) throw new Error(`fileUploads/upload: 会话 "${String(args.agent)}" 没有 agent`);
    // 上游按 `EncodedFileUploadRequest` 的形状读（`data` 是 base64），校验在它那边（zod codec）。
    return await this.uploads.upload(agent, args.request as EncodedFileUploadRequest, new AbortController().signal);
  }
}
