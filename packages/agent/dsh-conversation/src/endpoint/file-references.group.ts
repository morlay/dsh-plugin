// `fileReferences` 组的**两端共用面**：组名、deps 键、方法名与请求/应答形状。
//
// 输入框 `@` 的文件候选：上游是 `@deepseek-ai/dsh-api-session-controller` 那一族里的一个 namespace，
// 归对话域（会话界面的一部分）。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧的端点行继承它
// 实现方法。客户端形态不在本仓：这一组的客户端面由上游 `#fileReferences` 的 `$mount` 面提供。
//
// 方法签名从上游宿主面（`SessionFileReferences`）推（`Parameters<…>` / `ReturnType<…>`）：形状本来就在
// 那里定义，抄一遍只会多一份会漂的声明。
import type { SessionFileReferences } from "@deepseek-ai/dsh-api-session-controller";
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";

// wire 上的组名。

/** 组在 `Remote` 面上的 deps 键（`remote.fileReferences`）。 */
export const FILE_REFERENCES_REMOTE_KEY = "remote.fileReferences" as const;

/**
 * `fileReferences` 组：某个 agent 工作目录下的文件 / 目录候选。
 */
@RemoteGroup({ name: "fileReferences" })
export class FileReferencesEndpoint {
  /**
   * 列出候选。
   * @param _agent - 目标 agent（wire 上由会话身份解析出来的那个）。
   * @param _query - `@` / `@"` 后面的路径文本。
   * @param _signal - 调用方取消。
   * @returns 确定性的、只有路径的候选。
   */
  @RemoteMethod()
  async list(
    _agent: Parameters<SessionFileReferences["list"]>[0],
    _query: Parameters<SessionFileReferences["list"]>[1],
    _signal: Parameters<SessionFileReferences["list"]>[2],
  ): ReturnType<SessionFileReferences["list"]> {
    throw new Error("fileReferences/list：契约类未实现（宿主侧要在子类里实现它）");
  }
}
