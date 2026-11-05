// storage 域的 RDB 接管：把 `rdb` 注册成 storage 后端，所有 KV 域（workspace / session_projcache …）
// 都落到 `t_storage_units` / `t_storage_records` 上，不再写 `storages/*.json`。
//
// 为什么要有这一条：better-session 接管会话落盘只是**一半**——`StorageDomain` 的 KV 后端还是 json
// （`provideStorageJson` 那一行），所以 `dataDir/storages/` 会继续被创建与写入。源包靠 bundle patch
// 里 `storage-json` disabled + `storage-domain.backend: rdb` 换掉；本仓没有 patch，就落成这一行。
//
// 库句柄从**会话持久化**那一行取（`storageRepository()`）：KV 域与会话表必须同一个库，
// 否则事务跨不起来（导入 / 撤回里两边一起写）。
import { storageBackendServiceKey } from "@morlay/dsh-storage/contract";
import { Storage } from "@morlay/dsh-storage";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { inject, Injectable, Logger, type Context, type OnInit } from "@morlay/zephyr";
import { asRdbStore } from "../../contract/session-rdb-store.contract.ts";
import { RDB_STORAGE_BACKEND, RdbStorageBackend } from "./storage-backend.ts";

/** `rdb` storage 后端那一行（装配面并列装：它要 `ctx.storage` 那个 hub）。 */
@Injectable()
export class StorageTakeoverDefault implements OnInit {
  private readonly storage = inject(Storage);

  private readonly persistence = inject(SessionPersistence);

  private readonly logger = inject(Logger);

  onInit(ctx: Context): void {
    const repository = () => asRdbStore(this.persistence).storageRepository();
    const backend = new RdbStorageBackend(repository);
    const unregister = this.storage.backend.register(RDB_STORAGE_BACKEND, backend);
    ctx.effect(() => async () => {
      unregister();
      await backend.close();
    });
    // 上游 `storage-domain` 的 `apply` 用 `ctx.inject(['storage.backend.rdb'], …)` 等后端就绪：只
    // `register` 不发布这条 key，它那条 fiber 永远不激活（`ctx.storageDomain` 恒 `undefined`）。
    ctx.reflect.provide(storageBackendServiceKey(RDB_STORAGE_BACKEND), backend);
    void this.logger;
  }
}
