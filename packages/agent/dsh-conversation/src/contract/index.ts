// 对话域的**契约**（`@morlay/dsh-conversation/contract`）：两端共用的词与宿主面的抽象类。
//
// 这里的只有两类东西：**类型 / 抽象类 / 纯函数**（宿主与浏览器都能用，不引任何实现）。
// 实现类与装配函数在包根与 `./server`；端点名（组名 / deps 键 / 方法名）在 `./endpoint`。
export * from "./api-session.contract.ts";
// 标题的合成规则（纯函数）：宿主与会话存储都用它。
export * from "./session-title.contract.ts";
// 对话界面的 client 类型：两端共用（别的域按这些形状写 props，只引 contract）。
export * from "./conversation-client.contract.ts";
// 会话界面的 client 契约（别的 ui 也消费）：只具名转出需要的成员，
// `SessionControllerCovered` 与 `api-session.contract` 重复，不在此重复导出。
export {
  SessionController,
  type SessionScope,
  type SessionView,
} from "./session-controller.contract.ts";
