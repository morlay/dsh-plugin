// 测试装配：与我们自己的框架同一套声明（bootstrapApplication + Provider / Module）。
// 基础服务走聚合层（@morlay/dsh-base）的 fromCordis 适配；测试只从 app 取实例。
import {
  bootstrapApplication,
  InjectionToken,
  providersOfModule,
  type App,
  type ProviderList,
} from "@morlay/zephyr";
import { Context } from "@deepseek-ai/cordis";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import { SessionStore, SessionStoreDefault } from "@morlay/dsh-base/session";
import { SessionProjections, SessionProjectionDefault } from "@morlay/dsh-base/session-projection";
import { TokenMeter, TokenMeterDefault } from "@morlay/dsh-base/token-meter";
import { SessionBranchProvider } from "../branch/contract.ts";
import type { Config } from "../persistence/config.ts";
import { SessionPersistenceRdb } from "../persistence/session-persistence-rdb.service.ts";
import { RdbController } from "../persistence/rdb-controller.ts";
import { SessionRdbModule } from "../rdb.module.ts";

export interface RdbHarness {
  app: App;
  ctx: Context;
  sessions: SessionStore;
  persistence: SessionPersistenceRdb;
  branch: SessionBranchProvider;
}

export interface RdbHarnessOptions {
  config?: Config;
  // 用量折叠服务：只给需要 measure 的用例装（缺省不装，验证「缺失时告警」的分支）。
  tokenMeter?: boolean;
  // 测试替身（如假的 WebServer / AgentRegistry）；同名令牌覆盖装配里的默认项。
  providers?: ProviderList;
  // 装配超时：装了上游 domain（storageDomain / workspace）的用例链更长。
  timeoutMs?: number;
}

export const DEFAULT_TEST_CONFIG: Config = { type: "sqlite", path: ":memory:" };

// module 里 RdbController 的默认配置条目也要剔除：测试的配置必须覆盖它（否则会落到真实 DSH_HOME）。
function isRdbControllerEntry(entry: Parameters<typeof providersOfModule>[0] extends never ? never : unknown): boolean {
  if (entry === RdbController) return true;
  const provide = (entry as { provide?: { providerBase?: unknown } } | undefined)?.provide;
  return provide?.providerBase === RdbController;
}

// rdb 整行的 Provider 列表：module 里的 RdbController 换成带配置的那一份。
export function rdbProviders(config: Config = DEFAULT_TEST_CONFIG): ProviderList {
  return [
    SessionStoreDefault,
    SessionProjectionDefault,
    ...providersOfModule(SessionRdbModule).filter((entry) => !isRdbControllerEntry(entry)),
    // 放在最后：同 token 后者覆盖前者，测试配置必须赢过 Module 里的默认条目。
    RdbController.withConfig(config),
  ];
}

export async function harness(options: RdbHarnessOptions = {}): Promise<RdbHarness> {
  const ctx = new Context();
  const app = await bootstrapApplication({
    ctx,
    providers: [
      ...rdbProviders(options.config),
      ...(options.tokenMeter === true ? [TokenMeterDefault] : []),
      // 上游 `SessionStore` 会 `ctx.inject(['typert'])` 注册 lookup 表；测试给个最小替身，避免它读空。
      { provide: new InjectionToken("typert"), useValue: { lookups: { register() {} } } },
      ...(options.providers ?? []),
    ],
    timeoutMs: options.timeoutMs ?? 3000,
  });
  return {
    app,
    ctx,
    sessions: app.get(SessionStore) as SessionStore,
    persistence: app.get(SessionPersistence) as SessionPersistenceRdb,
    branch: app.get(SessionBranchProvider),
  };
}
