// 上游 `remote` 的**动态面**：`remote.<namespace>.<method>` 在运行期是 Proxy 回落出来的
// （`RemoteDefault` 的构造器按 descriptor 登记表回落，`LocalRemote` 把 namespace 挂在自己身上），
// 类型面上没有那些成员——所以这一读法收在本文件，调用方不再各写一次 `as unknown as Record<…>`。
//
// 读面只有两个：一个 namespace 的方法表（装配观测用）、一个具体方法（转发用）。
// 包出口（`./remote`）而不是相对路径：`Remote` 是两半共用的契约，浏览器面经出口取它
// （type-only，运行期不留边）。
import type { Remote } from "@morlay/zephyr-app/remote";

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
    throw new Error(`${remoteNamespaceKey(namespace)}.${method} 还没有登记（$mount 没跑？）`);
  }
  return handler as (...args: unknown[]) => Promise<unknown>;
}

/**
 * `remote.<group>` 这个 **cordis 服务名**（上游按它读 `ctx.remote.commands` 这类）。
 *
 * 我们自己声明的组（`@RemoteGroup` 的类）不在上游 `TYPERT_REMOTE` 里，所以那个名字得由我们
 * 通过 deps 发布；键名就是这个函数算的。名字规则只活在这里，别处不写 `"remote." + group`。
 *
 * **deps 键一律由它给出**：`[remoteNamespaceKey(xxxGroupName())]: remote`——组名从契约类上的
 * `@RemoteGroup` 读（`remoteGroupNameOf`，各域导出的 `xxxGroupName()` 取不到就当场抛）。
 * 不写字面量、也不存常量：字面量是同一件事的第二个 home，而只盯 `export const` 的判据会漏掉它。
 * 判据：`grep -rn '"remote\.[a-zA-Z]' packages --include='*.ts' | grep -v __tests__ | grep -v dynamic-face`
 * 应为 0。
 * @param group - 组名（`commands`）。
 * @returns cordis 服务名（`remote.commands`）。
 */
export function remoteNamespaceKey(group: string): string {
  return `remote.${group}`;
}
