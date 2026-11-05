// workspace 域的契约面（`@morlay/dsh-workspace/contract`）：进程内的端口，不涉及 remote。
export * from "./directory-picker.contract.ts";
export * from "./workspace.contract.ts";
// 浏览器半也要被别的 ui 消费的契约：放 contract，ui 自己再引用。
export { UiWorkspace } from "../ui/ui-workspace.token.ts";
