import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import {
  bootstrapApplication,
  configure,
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
import { AppEnvDefault, provideAppEnv, RemoteHandlersDefault } from "@morlay/zephyr-app";

const providers = (): readonly ProviderEntry[] => [
  // dsh 专属：部署参数与 Remote 路由表在 dsh 的 profile 里没有装配面，由这一层自带。
  // 排最前：后面的行注入它们，按序 mount 才能取到。
  // 部署参数是 dsh 的 home（DSH_HOME）：值由装配层给，AppEnv 自己不去读环境变量。
  ...provideAppEnv(configure(AppEnvDefault, { dataDir: dshHomePath(), profileDir: dshHomePath() })),
  RemoteHandlersDefault,
  ...provideSessionMode(),
  ...provideSessionModeEndpoints(),
  ...provideSubagentGuidance(),
  ...provideContextAssembler(),
];

// dsh 行入口：宿主侧（server / host）的行合成一个 cordis 插件；client 是独立出口，不进这里。
// `inject` 只列**本 bundle 之外**的服务：上游 Loader 据此等依赖就绪；本插件自己发布的服务由
// apply 内按序 mount 满足（把它们也列进去 = 等自己，永远不会激活）。
export default {
  name: "session-mode",
  inject: [
    "typert",
    "remoteAccess",
    "systemPrompt",
    "tools",
    "skills",
    "agents",
    "sessions",
    "sessionProjections",
    "storageDomain",
  ],
  async apply(ctx: Context): Promise<() => Promise<void>> {
    // 多行装配：行与行之间的服务互相可见（令牌表 + 依赖序），并且挂在宿主传入的 ctx 上——
    // dispose 只拆本次装配，不销毁宿主的 ctx。
    const app = await bootstrapApplication({ providers: providers(), ctx: ctx as never });
    return async () => {
      await app.dispose();
    };
  },
};

// patch 的行声明：只 insert 本包的行。
// 不再 disable 上游默认行——上下文装配与工具说明是上游概念（agent-instructions / system-prompt），
// 没有叫 context-assembler / tool-guidance 的上游行 id，禁了只会得到一条「entry not found」警告且静默无效
// （见票据 04「行 id 核对」）。
export const rows = [
  { insert: [{ id: "session-mode", name: "@morlay/dsh-session-mode-profile" }] },
] as const;
