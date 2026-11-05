// **remote 装载机制**：清单是**提供者登记的**（多值令牌 `RemoteDescriptor`），逐个取模块后 `$mount`。
//
// 这里不拼任何模块说明符：登记方给的是 import 本身（它的解析面才认得出那个包）。
export interface RemotesContext {
  remote: { $mount(contribution: unknown): Promise<() => Promise<void>> };
}

/**
 * 把登记到的 remote 逐个挂上去。
 * @param ctx - 提供 `$mount` 的 remote 服务。
 * @param descriptors - 登记的条目（每条的 `load` 由登记者提供）。
 * @returns 卸载函数（逆序）。
 */
export async function mountRemotes(
  ctx: RemotesContext,
  descriptors: readonly { load(): Promise<unknown> }[],
): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = [];
  try {
    for (const descriptor of descriptors) {
      const mod = (await descriptor.load()) as { default?: unknown };
      disposers.push(await ctx.remote.$mount(mod.default ?? mod));
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose();
    throw error;
  }
  return async () => {
    for (const dispose of disposers) await dispose();
  };
}
