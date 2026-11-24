import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { bootstrapApplication, configure, type Context, type ProviderEntry } from "@morlay/zephyr";
import { provideBetterSession, provideSessionBalance } from "@morlay/session-rdb/server";
import { AppEnvDefault, provideAppEnv, RemoteHandlersDefault } from "@morlay/zephyr-app";

const providers = (): readonly ProviderEntry[] => [
  // dsh 专属：部署参数与 Remote 路由表在 dsh 的 profile 里没有装配面，由这一层自带。
  // 排最前：后面的行注入它们，按序 mount 才能取到。
  // 部署参数是 dsh 的 home（DSH_HOME）：值由装配层给，AppEnv 自己不去读环境变量。
  ...provideAppEnv(configure(AppEnvDefault, { dataDir: dshHomePath(), profileDir: dshHomePath() })),
  RemoteHandlersDefault,
  ...provideBetterSession(),
  ...provideSessionBalance(),
];

// dsh 行入口：宿主侧（server / host）的行合成一个 cordis 插件；client 是独立出口，不进这里。
// `inject` 只列**本 bundle 之外**的服务：上游 Loader 据此等依赖就绪；本插件自己发布的服务由
// apply 内按序 mount 满足（把它们也列进去 = 等自己，永远不会激活）。
export default {
  name: "better-session",
  inject: ["typert", "remoteAccess", "sessions", "storage", "sessionProjections", "agents"],
  async apply(ctx: Context): Promise<() => Promise<void>> {
    // 多行装配：行与行之间的服务互相可见（令牌表 + 依赖序），并且挂在宿主传入的 ctx 上——
    // dispose 只拆本次装配，不销毁宿主的 ctx。
    const app = await bootstrapApplication({ providers: providers(), ctx: ctx as never });
    return async () => {
      await app.dispose();
    };
  },
};

// patch 的行声明：本包**替换**上游的默认实现——jsonl 落盘、json KV 后端、sqlite 查询、KV 版投影缓存
// 全部关掉，由上面那些 rdb 行接管。行 id 是上游默认行的 id（装配清单里的键），不是我们的类名。
export const rows = [
  { id: "session-persistence-jsonl", disabled: true },
  { id: "storage-json", disabled: true },
  { id: "session-query-sqlite", disabled: true },
  { id: "session-projection-cache", disabled: true },
  // 后端换成 rdb：`storage-json` 被 disable 之后，domain 的默认路由还指向 json 会 open 失败。
  { id: "storage-domain", config: { backend: "rdb" } },
  { insert: [{ id: "better-session", name: "@morlay/better-session" }] },
] as const;
