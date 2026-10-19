// storage-domain 契约：令牌按服务语义命名（上游注册名 `storageDomain`）。
import type { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import { Injectable } from "@morlay/zephyr";

interface StorageDomainFace {
  readonly open: DomainFacility["open"];
}

@Injectable()
export abstract class StorageDomain implements StorageDomainFace {
  abstract readonly open: StorageDomainFace["open"];
}
