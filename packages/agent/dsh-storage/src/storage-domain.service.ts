// storage-domain 行：**自己装配**（不挂上游 `apply`）。
//
// 上游 `apply` 用 `ctx.inject(['storage.backend.json'], …)` 在自己的 fiber 里等后端就绪，再在回调里
// `provide('storageDomain', …)`——那条路依赖「上游 provide 的名字进根名字视图」，与我们的隔离规则冲突。
// 这里直接组合它导出的 `DomainFacility`：后端注册表就在 `Storage.backend` 上，用我们自己的面即可。
import { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import { inject, Injectable, Logger, type Context, type OnInit } from "@morlay/zephyr";
import { Storage } from "./contract/storage.contract.ts";
import { StorageDomain } from "./contract/storage-domain.contract.ts";

/**
 * `DomainFacility` 需要行的三样能力：`effect`（生命周期）、`storage`（后端 + 数据面）
 * 与 **`logger`**（`domain/changed` 监听器失败时它要 `ctx.logger.warn`——缺了就是
 * `Cannot read properties of undefined (reading 'warn')`，且会把 workspace 的 create 留在待恢复状态）。
 */
interface FacilityHost {
  readonly ctx: { effect: Context["effect"]; storage: Storage; logger: Logger };
}

@Injectable()
export class StorageDomainDefault extends StorageDomain implements OnInit {
  private readonly storage = inject(Storage);

  private readonly logger = inject(Logger);

  private facility: DomainFacility | undefined;

  /** 装配面可覆盖的默认后端（`provideStorage.withConfig` 里显式给 `json`）。 */
  static withConfig(config: { backend: string }): typeof StorageDomainDefault {
    this.defaultBackend = config.backend;
    return this;
  }

  private static defaultBackend = "json";

  onInit(ctx: Context): void {
    // `ctx.extend()` 的父上下文不会被改：子 ctx 只是把 `storage` / `logger` 两个槽位影子化。
    const facility = new DomainFacility(
      ctx.extend({ storage: this.storage, logger: this.logger }),
      { backend: StorageDomainDefault.defaultBackend, routes: {} },
    );
    this.facility = facility;
    const unmount = this.storage.mount("domain", facility);
    ctx.effect(() => () => {
      // 卸载顺序：先关这一行自己开的 domain，再把它从 hub 上摘下来。
      void this.closeAll();
      unmount();
    });
  }

  /** 数据面：按 spec 打开一个 domain（转发给 facility）。 */
  open<S extends Parameters<StorageDomain["open"]>[0]>(spec: S): ReturnType<StorageDomain["open"]> {
    return this.opened().open(spec);
  }

  /** 按名字取已打开的 domain（转发给 facility）。 */
  get(name: Parameters<StorageDomain["get"]>[0]): ReturnType<StorageDomain["get"]> {
    return this.opened().get(name);
  }

  /** 关掉所有仍开着的 domain（转发给 facility）。 */
  async closeAll(): ReturnType<StorageDomain["closeAll"]> {
    if (this.facility === undefined) return;
    await this.facility.closeAll();
  }

  /** facility 在 `onInit` 里建；之前取用它属于装配顺序错误。 */
  private opened(): DomainFacility {
    if (this.facility === undefined) throw new Error("storage-domain 未初始化：装配顺序错误");
    return this.facility;
  }
}

export type { FacilityHost };
