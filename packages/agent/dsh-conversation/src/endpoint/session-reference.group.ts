// `sessionReferenceResolver` 组的**两端共用面**：组名、deps 键、方法名与请求/应答形状。
//
// `@` 菜单的会话候选：上游是 `@deepseek-ai/dsh-session-reference`，归对话域（会话引用是对话界面的一部分）。
//
// 组名与方法名的家是下面契约类上的 `@RemoteGroup({ name })` / `@RemoteMethod()`：宿主侧的端点行继承它
// 实现方法。客户端形态不在本仓：这一组的客户端面由上游 `#sessionReferenceResolver` 的 `$mount` 面提供。
//
// 方法签名从上游宿主面（`SessionReferenceResolver`）推（`Parameters<…>` / `ReturnType<…>`）：wire 上的方法名
// 是 `candidates`，上游的公开实现叫 `remoteExportCandidates`（`@Remote("candidates")`）——名字的 home 在
// 下面这个契约类的实参上，调用点不写字符串。
import type { SessionReferenceResolver } from "@deepseek-ai/dsh-session-reference";
import { RemoteGroup, RemoteMethod, remoteGroupNameOf } from "@morlay/zephyr-app/remote";

/**
 * 组名（`sessionReferenceResolver`）：唯一 home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns wire 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
export function sessionReferenceGroupName(): string {
  const group = remoteGroupNameOf(SessionReferenceEndpoint);
  if (group === undefined)
    throw new Error("SessionReferenceEndpoint 没有 @RemoteGroup：组名取不到");
  return group;
}

/**
 * `sessionReferenceResolver` 组：会话引用的候选（按工作目录亲和度排序）。
 */
@RemoteGroup({ name: "sessionReferenceResolver" })
export class SessionReferenceEndpoint {
  /**
   * 列出会话候选。
   * @param _agent - 目标 agent（自己会被排除，它的 cwd 决定排序）。
   * @param _query - 可选的大小写不敏感子串（会话 id / cwd / 标题）。
   * @param _signal - 可选的取消边界。
   * @returns 带规范 mention 标签与展示标题的候选。
   */
  @RemoteMethod()
  async candidates(
    _agent: Parameters<SessionReferenceResolver["remoteExportCandidates"]>[0],
    _query: Parameters<SessionReferenceResolver["remoteExportCandidates"]>[1],
    _signal: Parameters<SessionReferenceResolver["remoteExportCandidates"]>[2],
  ): ReturnType<SessionReferenceResolver["remoteExportCandidates"]> {
    throw new Error("sessionReferenceResolver/candidates：契约类未实现（宿主侧要在子类里实现它）");
  }
}
