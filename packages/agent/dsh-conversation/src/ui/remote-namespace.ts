// 上游 `Remote` 的 namespace 面：全包的「按名字取一条 face」只走这里。
//
// 为什么需要它：`Remote` 契约（`@morlay/zephyr-app` 的 `remote.contract.ts`）**故意不列 namespace**，
// 也不给按名字查的方法（那会退化成 service locator）：每个 namespace 由一条 `@RemoteContract` 各自成
// 契约，运行期才由 `RemoteDefault` 的 Proxy 按 `$mount` 登记的 descriptor 回落出来。静态面上没有这些
// 成员可写，读它只能经 `Reflect.get`。
//
// 断言只到**松散形状**（`Record<string, unknown>`），不冒充具体 face：调用方按自己真正要的那几个成员
// 收窄一次（`face as { control?(signal): AsyncIterable<unknown> }`）。`@morlay/zephyr-app` 内部有同一份
// 读法（`src/client/remote/dynamic-face.ts` 的 `remoteNamespaceOf`），但它没从任何出口导出来——出口面
// 归 zephyr-app 那张票；它一旦导出，本文件删掉、调用点换个名字即可。
import type { Remote } from "@morlay/zephyr-app/client";

/**
 * 上游 `Remote` 的一个 namespace 面（`remote.<name>`）。
 * @param remote - `Remote` 契约实例。
 * @param name - 上游 namespace 名（`session` / `commands` / `subagents` / `permissionPresets`…）。
 * @returns 成员名 → 成员；这一组还没 `$mount` 时 `undefined`。
 */
export function namespaceOf(remote: Remote, name: string): Record<string, unknown> | undefined {
  // namespace 是实例上的动态属性（Proxy 回落出来的），`Reflect.get` 是读它的正常入口。
  const face: unknown = Reflect.get(remote, name);
  return typeof face === "object" && face !== null ? (face as Record<string, unknown>) : undefined;
}
