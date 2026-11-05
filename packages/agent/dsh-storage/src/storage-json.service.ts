// storage-json 后端行：装上游插件 `storage-json`，令牌就是适配类自身（与 `StorageDefault` 同一类行）。
//
// 它注册的是上游 `Storage` hub 的后端（名字 `json`），所以契约在 `@morlay/dsh-storage`：
// 这里的行**不声明自己的契约**，`contract/` 目录因此不存在。
import * as StorageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AppEnv } from "@morlay/zephyr-app";
import { Storage } from "@morlay/dsh-storage";

/** 装配项：后端根目录。装配面不给时跟随 `AppEnv.dataDir`。 */
export interface StorageJsonConfig {
  /** 存储根目录；`undefined` 或 `"."` 都表示「按 `dataDir` 落位」。 */
  readonly root?: string;
}

@Injectable()
export class StorageJsonDefault extends fromCordis(StorageJsonPlugin) {
  storage = inject(Storage);

  /**
   * 运行环境：**存储根跟着 `dataDir`**。
   *
   * 装配面没显式给 `root`（或给的是 `"."`）时就取它。写死 `"."` 会让数据落到**进程 cwd**，
   * 与 `dataDir` 脱节——测试之间互相污染，多 profile 也会共用一份（实测：另一个 spec 留下的
   * workspace 与本 spec 的会话撞成「同一会话被两个工作区认领」）。
   */
  private readonly appEnv = inject.optional(AppEnv);

  /** 行配置（清单条目给的 root；基类接住构造参数）。 */
  /** 行配置（清单条目给的 root；基类接住构造参数）。 */
  private get rowOptions(): StorageJsonConfig {
    // `rowConfig` 是适配基类接住的装配值（`mount` 的缺省值），这里只做类型收窄。
    return (this.rowConfig ?? {}) as StorageJsonConfig;
  }

  override async onInit(ctx: Context): Promise<void> {
    const configured = this.rowOptions.root;
    const root =
      configured === undefined || configured === "."
        ? (this.appEnv?.values.dataDir ?? configured)
        : configured;
    await this.mount(ctx, root === undefined ? undefined : { ...this.rowOptions, root }, {
      storage: this.storage,
    });
  }
}
