// 两半共用的契约面：**一个出口**，host 与 client 都从这里取。
//
// 为什么单开一个出口：`src/client/**` 这类子入口面里的共享契约必须走包出口，而这几个契约又被 host
// 半（`src/api-gateway/**`、`src/index.ts`）用着——从包根取会把整个 host 桶拖进浏览器产物。
// 本出口只放**契约与纯类型工具**：不含实现、不含宿主依赖，浏览器半引用它是安全的。
export * from "../connection/contract.ts";
export * from "../connection/client.contract.ts";
export * from "../contract-coverage.ts";
export * from "../remote/remote-result.ts";
export * from "../remote/remote.contract.ts";
// 两端共用的运行时注册表契约（宿主：descriptor 登记与分派；浏览器：`contexts` 把 `agentId` 换回作用域）。
export { Typert } from "../typert/typert.contract.ts";
