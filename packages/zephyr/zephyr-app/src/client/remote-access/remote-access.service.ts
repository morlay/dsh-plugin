// 我们的实现：**不设访问限制**（本装配里 remote-access 的授权由 Host 侧决定，
// 浏览器端只给稳定的读面——读 `globalThis` 的那套基线注入在本仓不可用）。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { Slots } from "../renderer/slots.contract.ts";
import { RemoteAccess, type AccessEffect } from "./remote-access.contract.ts";

/** 「恒放行」的 observable：上游 `HostObservable<boolean>` 的形状（`source` / `useRemoteAccess` 都读它）。 */
const ALLOWED = {
  getSnapshot: (): boolean => true,
  subscribe: (): (() => void) => () => {},
};

@Injectable()
export class RemoteAccessDefault extends RemoteAccess {
  private readonly slots = inject(Slots);

  constructor() {
    super();
    this.context = undefined;
  }

  private context: Context | undefined;

  /** 行作用域：`whenAccess` 的效果挂在这里（随行卸载）。 */
  onInit(ctx: Context): void {
    this.context = ctx;
    // 上游 `ui-*` 行读 `useRemoteAccess(action)`：它是 root 标准源上的 keyedHook（`remoteAccess`），
    // 由 `api/remote-access` 的 `mountAccess` 发布。本装配自己实现这一行，所以也由这里发布。
    ctx.effect(() =>
      this.slots.provideRoot({
        keyedHooks: { remoteAccess: () => ALLOWED },
      }),
    );
  }

  /** 不限制：恒放行的 observable。 */
  source(): { getSnapshot(): boolean; subscribe(): () => void } {
    return ALLOWED;
  }

  /** 恒放行：立刻安装回调的效果，返回幂等 disposer。 */
  whenAccess(_action: string, callback: () => AccessEffect): () => void {
    return this.install(callback);
  }

  /** 资源版本：本装配里与 `whenAccess` 同义（判定同样恒放行）。 */
  whenResourceAccess(
    _kind: string,
    _id: string,
    _action: string,
    callback: () => AccessEffect,
  ): () => void {
    return this.install(callback);
  }

  /** 效果的安装/撤销：借行作用域的 `effect`（与上游 `whenAllowed` 的「已放行即同步安装」一致）。 */
  private install(callback: () => AccessEffect): () => void {
    const ctx = this.context;
    if (ctx === undefined) throw new Error("remote-access 未初始化：装配顺序错误");
    const dispose = ctx.effect(callback);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      void dispose();
    };
  }
}
