// 工作区注册表：**调用时按名读**（可选能力的取用方式，与 `admin/store.ts` 的 `branchOf` 同一口径）。
//
// 为什么不用 `inject.optional(WorkspaceRegistry)`：注入是**装配序边**，而 `Workspace` 行反过来
// `inject(SessionPersistence)` + `inject(StorageDomain)`，两条边与本包的会话行成环。内核的拓扑排序
// 对环的处理是把「先访问者」排后（`bootstrap.ts` 的 `orderByDependencies`：环上的回边跳过、先到者先入序），
// 于是 workspace 行会插到本包（持久化 / storage 接管）**之前**：它在自己的 init 里就
// `storageDomain.open("workspace")`，此刻 `rdb` 后端还没注册
// （`storage backend 'rdb' is not registered (registered: none)`）、会话库也还没打开。
//
// 装配是逐行 await 的，所以"让域行等后端就绪"只会与 workspace 行的 init 互相等待（死锁）；
// 唯一可行的口径是把这条静态边去掉，改成调用时读。名字从**令牌元数据**取（派生名 + 上游别名），
// 不在调用点手抄字符串。
import { WorkspaceRegistry } from "@morlay/dsh-workspace";
import { tokenMetaOf, type Context } from "@morlay/zephyr";

/**
 * 取 workspace 注册表。
 * @param ctx - 本行的 ctx（`onInit` 拿到的那份）；还没拿到时给 `undefined`。
 * @returns 注册表，或 `undefined`（装配里没有它：headless / 测试装配 / 启动早期）。
 */
export function readWorkspaceRegistry(ctx: Context | undefined): WorkspaceRegistry | undefined {
  if (ctx === undefined) return undefined;
  const meta = tokenMetaOf(WorkspaceRegistry);
  for (const name of [meta.name]) {
    if (name === undefined) continue;
    // `ctx.get` 是 `reflect.get` 的封装：语义相同但返回 `unknown`，收窄必须显式写在下面。
    const found = ctx.get(name, false);
    if (found !== undefined && found !== null) return found as WorkspaceRegistry;
  }
  return undefined;
}
