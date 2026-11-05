// `just custom web` 的入口：只做「推导行清单 → `bootstrapApplication({ providers })`」。
// 配置（路径、dev 形态、行清单）都在 `zephyr.provide.ts` 的 `customProvidersOf` 里，入口不自己拼清单。
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { clientPackagesOf, ServerHmr, ViteHandoff } from "@morlay/zephyr-app";
import { AgentDirectory } from "@morlay/dsh-agent";
import { JobRegistry } from "@morlay/dsh-job";
import { customProvidersOf } from "./zephyr.provide.ts";

const rows = [
  ...new Set(await clientPackagesOf(customProvidersOf([]))),
];

/** 当前这棵树：HMR 重载会整棵换掉，退出时拆的也是它。 */
let app: App;

/**
 * 开发态的**服务端** HMR。
 *
 * 客户端那半由 vite 自己热更；这里只管"服务端源码变了 → 换掉整棵行树"。
 * 为什么是整树而不是模块级热替换：行之间注入的是**实例**，只换一个模块等于让旧行继续握着旧实例，
 * 那比直接报错更难查。`ServerHmr` 负责等空闲（有在途请求时换树，那条请求会拿到半新半旧的对象图）。
 * @param instance - 刚起好的那棵树。
 */
function installServerHmr(instance: App): void {
  const handoff = instance.tryGet(ViteHandoff);
  const hmr = instance.tryGet(ServerHmr);
  if (handoff === undefined || hmr === undefined) return;
  const agents = instance.tryGet(AgentDirectory);
  const jobs = instance.tryGet(JobRegistry);
  /**
   * 业务层空闲：没有 Agent 开着 turn，也没有后台任务在跑。
   *
   * 两者都属于"换树会让它半路换手"的状态：turn 开着时模型调用在途；后台任务跑着时
   * 它的输出管道与句柄挂在被换掉的行上。`finishedAt` 缺失就是还活着（`JobView` 的判据）。
   */
  const idle = (): boolean =>
    (agents === undefined ||
      agents
        .list()
        .every((agent) => agents.turnBoundaryOf(agent.session).openTurnStartSeq === null)) &&
    (jobs === undefined || jobs.list().every((job) => job.finishedAt !== undefined));
  hmr.install({
    isIdle: idle,
    reload: async () => {
      // 旧树在这里拆：`ServerHmr` 自己也是旧树的一行，拆完之后新树会再装一份 HMR。
      await instance.dispose();
      app = await start();
      console.info("[dev] 服务端行树已重载");
    },
  });
  handoff.onServerSourceChange((file) => {
    hmr.notify(file);
  });
}

/**
 * 起一棵行树（重载时也会走这条路）。
 * @returns 装配好的应用。
 */
async function start(): Promise<App> {
  const instance = await bootstrapApplication({
    providers: customProvidersOf(rows),
    timeoutMs: 30_000,
  });
  installServerHmr(instance);
  return instance;
}

app = await start();

const shutdown = (): void => {
  void app.dispose().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
