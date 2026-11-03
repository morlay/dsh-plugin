import type { Context } from "@deepseek-ai/cordis";
import { storageBackendServiceKey } from "@deepseek-ai/dsh-storage";
import { SessionProjectionCacheRdb } from "./projection-cache.ts";
import { RDB_STORAGE_BACKEND, RdbStorageBackend } from "./storage-backend.ts";
import type { StorageRepository } from "./types.ts";

export interface StorageTakeoverOptions {
  /** backend 打开后才有值：接管在构造期完成，真正的读写在打开后发生。 */
  repository: () => Promise<StorageRepository>;

  ready: Promise<unknown>;
}

export function installStorageTakeover(ctx: Context, options: StorageTakeoverOptions): void {
  ctx.inject(["storage"], (storageCtx) => {
    const backend = new RdbStorageBackend(options.repository);
    storageCtx.effect(() => {
      const unregister = storageCtx.storage.backend.register(RDB_STORAGE_BACKEND, backend);
      return async () => {
        unregister();
        await backend.close();
      };
    }, "session-rdb.storageBackend");
    storageCtx.provide(storageBackendServiceKey(RDB_STORAGE_BACKEND), backend);
  });

  ctx.plugin(SessionProjectionCacheRdb, {
    repository: options.repository,
    ready: options.ready,
  });
}
