// remote 的**浏览器面**：装饰器 + 会话远程实例 + 装配。
//
// 端点面（`src/endpoint/**`）两端共用，所以它写 `@RemoteGroup` / `@RemoteMethod` 与返回类型时
// 只能从这一面取：宿主面（`../../remote/index.ts`）会带进 `RemoteClient` / 注册表 / `MuxServer` 那一串。
export * from "@morlay/zephyr-app/remote/decorators";
// 宿主面把组 / 方法装饰器导出成 `RemoteMethod`（`Remote` 这个名字归上游装载面契约）：这里给同名别名，
// 让端点面换说明符就够，不用改装饰器的用法。
export { Remote as RemoteMethod } from "@morlay/zephyr-app/remote/decorators";
// unary 的结果封装是**纯类型**（`RemoteResultWire` / `RemoteFailureWire`）；宿主侧的
// `asRemoteResult` / `failureOf` 不进这一面。
export type { RemoteFailureWire, RemoteResultWire } from "@morlay/zephyr-app/contract";
// 上游 `remote` 动态面的读法与名字（`remote.<group>` 的服务名只从 `remoteNamespaceKey` 算）。
export * from "./dynamic-face.ts";
export * from "./remote.service.ts";
export * from "./provide.ts";
