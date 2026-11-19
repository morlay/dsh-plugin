import {
  mountRow,
  providerOfPlugin,
  type Context,
  type Newable,
  type ProviderEntry,
} from "@morlay/zephyr";
import { provideAgentUse } from "@morlay/agent-use";

const providers = (): readonly ProviderEntry[] => [...provideAgentUse()];

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
  name: "agent-use",
  async apply(ctx: Context): Promise<void> {
    for (const entry of providers()) {
      const { impl, config } = implOf(entry);
      await mountRow(ctx, impl, config);
    }
  },
};

// patch 的行声明：dsh Loader 按它装配本包的行入口（`name` 指到 `./dsh-bundle` 子出口）。
export const rows = [
  { insert: [{ id: "agent-use", name: "@morlay/agent-use/dsh-bundle" }] },
] as const;
