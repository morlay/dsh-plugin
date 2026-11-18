import { mountRow, providerOfPlugin, type Context, type Newable, type ProviderEntry } from "@morlay/zephyr";
import { provideBetterSession, provideSessionBalance } from "@morlay/better-session/server";

const providers = (): readonly ProviderEntry[] => [...provideBetterSession(), ...provideSessionBalance()];

function implOf(entry: ProviderEntry): { impl: Newable<unknown>; config?: unknown } {
  if (typeof entry === "function") return { impl: entry };
  const plugin = providerOfPlugin(entry);
  if (plugin !== undefined) return { impl: plugin as Newable<unknown> };
  const provider = (entry as { provide: Newable<unknown> }).provide;
  return "config" in entry
    ? { impl: provider, config: (entry as { config?: unknown }).config }
    : { impl: provider };
}

// dsh 行入口：宿主侧（server / host）的行合成一个 cordis 插件；client 是独立出口，不进这里。
export default {
  name: "@morlay/better-session",
  async apply(ctx: Context): Promise<void> {
    for (const entry of providers()) {
      const { impl, config } = implOf(entry);
      await mountRow(ctx, impl, config);
    }
  },
};
