// workspace 域的**测试支撑**出口（`@morlay/dsh-workspace/testing`）：内存注册表与造行 helper。
//
// 下游要用「一份满足 `WorkspaceRegistry` 契约的注册表」时从这里取，别各自再写一份替身。
export { FakeWorkspaceRegistry, workspaceOf } from "./fake-workspace-registry.ts";
export type { AttachRecord, FakeWorkspace } from "./fake-workspace-registry.ts";
