// storage 聚合面契约：令牌按服务语义命名（上游注册名 `storage`）。
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";
import { Storage as StorageHub } from "@deepseek-ai/dsh-storage";

// 能力词汇：后端这一面（后端的读写面、KV 单元与门面的形状、失败类型、服务名约定）。
// 换一个后端（RDB / json / 内存）要实现的就是这些，所以它们跟 hub 契约放在一处。
/** 存储后端的失败（带码），消费方按它分派。 */
export { StorageError } from "@deepseek-ai/dsh-storage";
/** 一个 KV 门面的形状（单元内按 facet 切）。 */
export type { KvFacet } from "@deepseek-ai/dsh-storage";
/** 一个 KV 单元：名字 + 门面表。 */
export type { KvUnit } from "@deepseek-ai/dsh-storage";
/** 单元的登记形状（谁注册、提供哪些门面）。 */
export type { KvUnitDescriptor } from "@deepseek-ai/dsh-storage";
/** 后端的读写面（实现一个后端就要满足它）。 */
export type { StorageBackend } from "@deepseek-ai/dsh-storage";
/** 后端在 ctx 上的服务名约定（纯函数）。 */
export { storageBackendServiceKey } from "@deepseek-ai/dsh-storage";

@Injectable({ name: "storage" })
export abstract class Storage {
  abstract readonly backend: StorageHub["backend"];

  abstract readonly mount: StorageHub["mount"];

  abstract readonly form: StorageHub["form"];

  abstract readonly domain: StorageHub["domain"];
}

/**
 * 覆盖守卫（严格）：上游 `StorageHub` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type StorageCovered = AssertTrue<AssertCoveredStrict<StorageHub, Storage>>;
