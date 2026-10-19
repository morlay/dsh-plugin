// host 侧的 remote 面：上游契约 + 声明式注册。
//
// `Remote` 这个名字归上游装载面契约（`remote.contract.ts`），方法装饰器以 `RemoteMethod` 导出，
// 避免同名冲突；浏览器半需要 `@Remote` 时从 `@morlay/zephyr-app/client/remote` 拿。
export * from "./remote.contract.ts";
export {
  Remote as RemoteMethod,
  RemoteClient,
  RemoteGroup,
  remoteGroupNameOf,
  remoteMethodsOf,
  remoteStreamMethodsOf,
} from "./decorators.ts";
export * from "./client-base.ts";
export * from "./remote-result.ts";
export * from "./register.ts";
