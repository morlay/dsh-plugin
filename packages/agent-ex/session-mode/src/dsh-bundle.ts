import {
  mountRow,
  providerOfPlugin,
  type Context,
  type Newable,
  type ProviderEntry,
} from "@morlay/zephyr";
import {
  provideContextAssembler,
  provideSessionMode,
  provideSessionModeEndpoints,
  provideSubagentGuidance,
} from "@morlay/session-mode";

const providers = (): readonly ProviderEntry[] => [
  ...provideSessionMode(),
  ...provideSessionModeEndpoints(),
  ...provideSubagentGuidance(),
  ...provideContextAssembler(),
];

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
  name: "session-mode",
  async apply(ctx: Context): Promise<void> {
    for (const entry of providers()) {
      const { impl, config } = implOf(entry);
      await mountRow(ctx, impl, config);
    }
  },
};

// patch 的行声明：本包**替换**上游的两条默认实现——上下文装配与工具说明分组由这里的行接管。
// 行 id 是上游默认行的 id（装配清单里的键），不是我们的类名。
export const rows = [
  { id: "context-assembler", disabled: true },
  { id: "tool-guidance", disabled: true },
  { insert: [{ id: "session-mode", name: "@morlay/session-mode/dsh-bundle" }] },
] as const;
