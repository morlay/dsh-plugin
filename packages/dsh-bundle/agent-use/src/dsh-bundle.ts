import { bootstrapApplication, type Context, type ProviderEntry } from "@morlay/zephyr";
import { provideAgentUse } from "@morlay/agent-use";

const providers = (): readonly ProviderEntry[] => [...provideAgentUse()];

// dsh 行入口：宿主侧（server / host）的行合成一个 cordis 插件；client 是独立出口，不进这里。
// `inject` 只列**本 bundle 之外**的服务：上游 Loader 据此等依赖就绪；本插件自己发布的服务由
// apply 内按序 mount 满足（把它们也列进去 = 等自己，永远不会激活）。
export default {
  name: "agent-use",
  inject: ["tools"],
  async apply(ctx: Context): Promise<() => Promise<void>> {
    // 多行装配：行与行之间的服务互相可见（令牌表 + 依赖序），并且挂在宿主传入的 ctx 上——
    // dispose 只拆本次装配，不销毁宿主的 ctx。
    const app = await bootstrapApplication({ providers: providers(), ctx: ctx as never });
    return async () => {
      await app.dispose();
    };
  },
};

// patch 的行声明：dsh Loader 按它装配本包的行入口（`name` 指到 `./dsh-bundle` 子出口）。
export const rows = [
  { insert: [{ id: "agent-use", name: "@morlay/dsh-agent-use-profile" }] },
] as const;
