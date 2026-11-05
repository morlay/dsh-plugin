// `session` 这一个 remote 组：只有**方法契约**（没有 `face`——内部不暴露上游形态）。
//
// 与上游的对齐全在 `@RemoteGroup`/`@Remote` 的转发里（通用模块），业务只调契约方法。
import { inject } from "@morlay/zephyr";
import { Remote as RemoteContract } from "../../remote/remote.contract.ts";
import { Remote, RemoteGroup } from "../../remote/decorators.ts";

/** 契约：`remote.session` 这一组。 */
@RemoteGroup({ name: "session" })
export abstract class SessionRemote {
  /** 会话列表（上游 `remote.session.list`）。 */
  abstract list(): Promise<unknown>;

  /** 建会话（上游 `remote.session.create`）。 */
  abstract create(request: unknown): Promise<unknown>;

  /** 读一页历史（上游 `remote.session.readPage` → wire `session/page`）。 */
  abstract readPage(request: unknown, throughSeq: number, signal: AbortSignal): Promise<unknown>;
}

/** 实现：只声明依赖，方法体为空（转发由 `@Remote()` 生成）。 */
@RemoteGroup()
export class SessionRemoteDefault extends SessionRemote {
  /** 依赖在**属性**上 inject：进 `dependencies`，拓扑排序才保证 `Remote` 先就位。 */
  protected readonly remote = inject(RemoteContract);

  @Remote()
  async create(request: unknown): Promise<unknown> {
    const face = (this.remote as unknown as { session?: { create?: (r: unknown) => Promise<unknown> } }).session;
    if (face?.create === undefined) {
      throw new Error("SessionRemoteDefault.create：remote.session 还没有登记（$mount 没跑？）");
    }
    return face.create(request);
  }

  @Remote()
  async readPage(request: unknown, throughSeq: number, signal: AbortSignal): Promise<unknown> {
    const face = (this.remote as unknown as {
      session?: { readPage?: (r: unknown, seq: number, s: AbortSignal) => Promise<unknown> };
    }).session;
    if (face?.readPage === undefined) {
      throw new Error("SessionRemoteDefault.readPage：remote.session 还没有登记（$mount 没跑？）");
    }
    return face.readPage(request, throughSeq, signal);
  }

  @Remote()
  async list(): Promise<unknown> {
    // 走 `remote.session.list`（descriptor 登记后由 Proxy 提供的调用面）——
    // 这里**不能**是 `return undefined` 的桩：那会让「谁都没请求过 list」这种事实彻底静默。
    const face = (this.remote as unknown as { session?: { list?: () => Promise<unknown> } }).session;
    if (face?.list === undefined) {
      throw new Error("SessionRemoteDefault.list：remote.session 还没有登记（$mount 没跑？）");
    }
    return face.list();
  }
}
