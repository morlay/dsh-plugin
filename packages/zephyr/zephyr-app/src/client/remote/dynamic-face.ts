// 上游 `remote` 的**动态面**：`remote.<namespace>.<method>` 在运行期是 Proxy 回落出来的
// （`RemoteDefault` 的构造器按 descriptor 登记表回落，`LocalRemote` 把 namespace 挂在自己身上），
// 类型面上没有那些成员——所以这一读法收在本文件，调用方不再各写一次 `as unknown as Record<…>`。
//
// 读面只有两个：一个 namespace 的方法表（装配观测用）、一个具体方法（转发用）。
import type { Remote } from "../../remote/remote.contract.ts";

/**
 * 一个 namespace 的方法表（`remote.<namespace>` 那一面）。
 * @param remote - `Remote` 契约实例。
 * @param namespace - 上游 namespace 名（`session`）。
 * @returns 方法名 → 可调用值；没挂这一组时 `undefined`。
 */
export function remoteNamespaceOf(
  remote: Remote,
  namespace: string,
): Record<string, unknown> | undefined {
  // 动态回落只在实例上（不是原型链上的声明），`Reflect.get` 是读它的正常入口。
  const face: unknown = Reflect.get(remote, namespace);
  return typeof face === "object" && face !== null ? (face as Record<string, unknown>) : undefined;
}

/**
 * 一个具体方法（`remote.<namespace>.<method>`）。
 *
 * 缺了**不静默**：没登记就抛，报错点在调用处，不漂到上游内部（`reading 'catalog'` 那种）。
 * @param remote - `Remote` 契约实例。
 * @param namespace - 上游 namespace 名（`session`）。
 * @param method - 组内方法名（`create`）。
 * @returns 该方法（已从面上取出，调用时不带 `this`）。
 */
export function remoteMethodOf(
  remote: Remote,
  namespace: string,
  method: string,
): (...args: unknown[]) => Promise<unknown> {
  const handler = remoteNamespaceOf(remote, namespace)?.[method];
  if (typeof handler !== "function") {
    throw new Error(`remote.${namespace}.${method} 还没有登记（$mount 没跑？）`);
  }
  return handler as (...args: unknown[]) => Promise<unknown>;
}
