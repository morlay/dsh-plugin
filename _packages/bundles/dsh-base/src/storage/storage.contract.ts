// storage 聚合面契约：令牌按服务语义命名（上游注册名 `storage`）。
import type { Storage as StorageHub } from "@deepseek-ai/dsh-storage";
import { Injectable } from "@morlay/zephyr";

interface StorageFace {
  readonly backend: StorageHub["backend"];
  readonly mount: StorageHub["mount"];
}

@Injectable()
export abstract class Storage implements StorageFace {
  abstract readonly backend: StorageFace["backend"];

  abstract readonly mount: StorageFace["mount"];
}
