import {
  mountRow,
  providerOfPlugin,
  type Context,
  type Newable,
  type ProviderEntry,
} from "@morlay/zephyr";
import { provideBetterSession, provideSessionBalance } from "@morlay/better-session/server";

const providers = (): readonly ProviderEntry[] => [
  ...provideBetterSession(),
  ...provideSessionBalance(),
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
  name: "better-session",
  async apply(ctx: Context): Promise<void> {
    for (const entry of providers()) {
      const { impl, config } = implOf(entry);
      await mountRow(ctx, impl, config);
    }
  },
};

// patch 的行声明：本包**替换**上游的默认实现——jsonl 落盘、json KV 后端、sqlite 查询、KV 版投影缓存
// 全部关掉，由上面那些 rdb 行接管。行 id 是上游默认行的 id（装配清单里的键），不是我们的类名。
export const rows = [
  { id: "session-persistence-jsonl", disabled: true },
  { id: "storage-json", disabled: true },
  { id: "session-query-sqlite", disabled: true },
  { id: "session-projection-cache", disabled: true },
  { insert: [{ id: "better-session", name: "@morlay/better-session/dsh-bundle" }] },
] as const;
