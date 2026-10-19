// `remote.workspace` 这一组面：给 `Remote` 补一条 namespace 声明，并给模型一个**每次调用才解析**的转发器。
//
// 上游把每个 namespace 声明在合并面 `TypertRemoteNamespaceMap` 上（`workspace-controller` 的
// `lib/typert.remote-client.ts:582`），我们的 `Remote` 契约刻意不列举 namespace（那是 service locator）。
// 本包是 workspace 这一个 namespace 的唯一消费方，所以按上游同一手法在这里补**这一条**声明；
// 运行时由 `RemoteDefault` 的 Proxy 在 `$mount` 登记后兑现。
import type { WorkspaceRemote } from "@deepseek-ai/dsh-api-workspace-controller/client";
import type { Remote } from "@morlay/zephyr-app/client";

declare module "@morlay/zephyr-app/client" {
  interface Remote {
    /** `workspace-controller` 的 typert 绑定；`whenNamespace("workspace")` 之后才存在。 */
    readonly workspace?: WorkspaceRemote;
  }
}

/**
 * `WorkspaceRemote` 的转发实现：模型在 `$mount` 之前就会构造，所以**每次调用**才取当前的 namespace 面，
 * 构造期不读它。
 */
export class LiveWorkspaceRemote implements WorkspaceRemote {
  constructor(private readonly remoteOf: () => Remote) {}

  private get face(): WorkspaceRemote {
    const face = this.remoteOf().workspace;
    if (face === undefined) {
      throw new Error('remote.workspace is not mounted yet; await whenNamespace("workspace") first');
    }
    return face;
  }

  readonly archiveSession: WorkspaceRemote["archiveSession"] = (request) => this.face.archiveSession(request);

  readonly create: WorkspaceRemote["create"] = (request) => this.face.create(request);

  readonly delete: WorkspaceRemote["delete"] = (request) => this.face.delete(request);

  readonly follow: WorkspaceRemote["follow"] = (signal) => this.face.follow(signal);

  readonly initializeDefault: WorkspaceRemote["initializeDefault"] = (signal) => this.face.initializeDefault(signal);

  readonly insertBefore: WorkspaceRemote["insertBefore"] = (request) => this.face.insertBefore(request);

  readonly insertSessionBefore: WorkspaceRemote["insertSessionBefore"] = (request) =>
    this.face.insertSessionBefore(request);

  readonly pinSession: WorkspaceRemote["pinSession"] = (request) => this.face.pinSession(request);

  readonly rename: WorkspaceRemote["rename"] = (request) => this.face.rename(request);

  readonly unarchiveSession: WorkspaceRemote["unarchiveSession"] = (request) =>
    this.face.unarchiveSession(request);

  readonly unpinSession: WorkspaceRemote["unpinSession"] = (request) => this.face.unpinSession(request);
}
