// 通用 DB 控制面：持有 backend / tracker / ready / storeIdentity，行配置只进来一次。
// 持久化、查询、分支、用量等 Provider 都从它取同一个 backend，不各自建连接。
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { Injectable, withConfig } from "@morlay/zephyr";
import type { Backend } from "../backend.ts";
import { createBackend } from "./create-backend.ts";
import { ConfigSchema, type Config, type ResolvedConfig } from "./config.ts";
import { RdbBackendTracker } from "./rdb-tracker.ts";

@Injectable()
export class RdbController {
  static Config = ConfigSchema;

  static readonly withConfig = withConfig;

  readonly config: Config;

  readonly backend: Backend;

  readonly tracker: RdbBackendTracker;

  readonly ready: Promise<void>;

  storeIdentity!: string;

  constructor(config?: Config | ResolvedConfig, backend?: Backend) {
    // 行 config 缺省（bootstrap 直接装配、或 patch 行没写 config）时落到部署默认库。
    const given = config as Record<string, unknown> | undefined;
    const input =
      given === undefined || given === null || Object.keys(given).length === 0
        ? { type: "sqlite" as const, path: dshHomePath("sessions", "sessions.sqlite") }
        : config!;
    // 行装配传的是 ConfigSchema 解析后的 volatile 值；测试 / 直接 bootstrap 传原始配置，这里统一解析一次。
    const volatile = input as { get?: () => Config };
    const resolved =
      typeof volatile.get === "function" ? (input as ResolvedConfig) : ConfigSchema(input as Config);
    this.config = resolved.get();
    this.backend = backend ?? createBackend(this.config);
    this.tracker = new RdbBackendTracker("session-rdb");
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.backend.open();
    this.storeIdentity = this.backend.storeIdentity;
  }
}
