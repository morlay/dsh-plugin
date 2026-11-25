// `remote` 的最小装配：只装 `Remote` 的实现（通用挂载机制），不含任何业务组。
//
// 业务包的 `@RemoteGroup` 组由**它自己的域**挂（`Remote.$mount(remoteDescriptorsOf(组契约))`）：
// 框架不知道有哪些业务组，也不知道它们的 wire 形状。
//
// 业务包要在自己的测试里闭环（例如 `dsh-session` 验「建会话 → 事件 → store」），
// 需要的是这一块而不是整条 `ClientChainModule`（那条要浏览器 DOM）。
import { provide } from "@morlay/zephyr";
import { RemoteDefault } from "./remote.service.ts";

/** Remote 契约的实现：通用挂载机制（`$mount` / `remoteDescriptorsOf` / `@RemoteGroup`）。 */
export const provideClientRemote = provide([RemoteDefault]);
