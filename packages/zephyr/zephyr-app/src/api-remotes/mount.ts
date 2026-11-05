// **remote 装载机制**：清单由装配方给（`AppEnv.remotes`），逐个**动态 import** 后 `$mount`。
// 这里不维护任何默认清单——每个 namespace 是各自模块的事（和 client-module 的行清单同一个原则）。
export interface RemotesContext {
  remote: { $mount(contribution: unknown): Promise<() => Promise<void>> };
}

export async function mountRemotes(
  ctx: RemotesContext,
  remotes: readonly string[],
): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = [];
  try {
    for (const name of remotes) {
      const mod = (await import(`@deepseek-ai/${name}/remote`)) as { default?: unknown };
      disposers.push(await ctx.remote.$mount(mod.default ?? mod));
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose();
    throw error;
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose();
  };
}
