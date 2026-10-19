// 存储接管（rdb 专用）：把 rdb 后端注册成 `storage.backend.rdb`，让 storage 域（workspace / 投影缓存等）
// 落在同一个库。依赖只到 RdbController（不经过 sessionPersistence，避免与 storage 成环）。
import { storageBackendServiceKey } from "@deepseek-ai/dsh-storage";
import { Storage } from "@morlay/dsh-base/storage";
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";
import { RdbController } from "../persistence/rdb-controller.ts";
import { RDB_STORAGE_BACKEND, RdbStorageBackend } from "./storage-backend.ts";

@Injectable()
export class SessionStorageTakeover {
  rdb = inject(RdbController);

  // 没有 storage 聚合面（纯持久化测试）就跳过接管：rdb 仍然可用。
  storage = inject.optional(Storage);

  logger = inject(Logger);

  onInit(ctx: Context): void {
    const storage = this.storage as unknown as
      | { backend?: { register?(name: string, backend: unknown): () => void } }
      | undefined;
    const backendFacet = storage?.backend;
    const register = backendFacet?.register;
    if (backendFacet === undefined || register === undefined) return;
    const backend = new RdbStorageBackend(this.rdb.backend.storage);
    const root = (ctx as unknown as { root: { reflect: { provide(name: string, value: unknown): () => void } } })
      .root;
    ctx.effect(() => {
      const unprovide = root.reflect.provide(storageBackendServiceKey(RDB_STORAGE_BACKEND), backend);
      const unregister = register.call(backendFacet, RDB_STORAGE_BACKEND, backend);
      return async () => {
        unprovide();
        unregister();
        await backend.close();
      };
    }, "session-rdb.storageBackend");
  }
}
