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

// patch 的行声明：只 insert 本包的行。
// 不再 disable 上游默认行——上下文装配与工具说明是上游概念（agent-instructions / system-prompt），
// 没有叫 context-assembler / tool-guidance 的上游行 id，禁了只会得到一条「entry not found」警告且静默无效
// （见票据 04「行 id 核对」）。
export const rows = [
  { insert: [{ id: "session-mode", name: "@morlay/session-mode/dsh-bundle" }] },
] as const;
