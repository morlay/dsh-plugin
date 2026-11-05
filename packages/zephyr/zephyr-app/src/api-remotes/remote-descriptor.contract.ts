// remote namespace 的**声明面**：谁装了这个 remote 的宿主行，谁在自己的 `./server` 装配清单里登记一条。
//
// **登记方交出的是 import**，不是一个名字：`mountRemotes` 只是把登记到的东西 `$mount` 起来。
// 早先这里只存 `name`、由 `mountRemotes` 拼 `@deepseek-ai/<name>/remote` 去动态 import——那条说明符
// 是在**本包**（框架包）的位置上解析的，而真正声明了那个依赖的是登记者（业务包）。结果是这条链
// 一律解析不到（实测：从 `zephyr-app` 目录 import 该包 = `ERR_MODULE_NOT_FOUND`，从应用目录才通）。
// 「谁能解析它，谁提供 import」没有第二条规则。
import { Injectable, type ValueProvider } from "@morlay/zephyr";

/** 一个 remote namespace 的声明（多值令牌）。 */
@Injectable({ multi: true })
export abstract class RemoteDescriptor {
  /** 取这个 remote 的模块（`@deepseek-ai/<pkg>/remote` 的默认导出或它本身）。 */
  abstract readonly load: () => Promise<unknown>;
}

/**
 * 造一条 descriptor 条目（给域包的 `./server` 装配清单用）。
 * @param load - 取 remote 模块的 import（写 `() => import("@deepseek-ai/<pkg>/remote")`）。
 * @returns 装配清单条目。
 */
export function remoteDescriptor(load: () => Promise<unknown>): RemoteDescriptorEntry {
  return { provide: RemoteDescriptor, useValue: { load } };
}

/**
 * descriptor 条目的类型：`provide` 与 `useValue` 都收窄到具体面。
 *
 * 返回宽的 `ValueProvider`（`useValue: unknown`）会让 `bootstrapApplication` 的覆盖检查把这一条
 * 当成"什么都不知道"，进而把整个清单的推断拖成"缺依赖"（`dsh-goal` 的 spec 撞过）。
 */
export type RemoteDescriptorEntry = ValueProvider & {
  readonly provide: typeof RemoteDescriptor;
  readonly useValue: { readonly load: () => Promise<unknown> };
};
