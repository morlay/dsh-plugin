// storage 聚合面契约：令牌按服务语义命名（上游注册名 `storage`）。
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";
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

/**
 * 契约面：上游 `Storage` hub 的**全部**公开成员。
 *
 * 上游插件按 `ctx.storage.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`：
 * `backend` 是后端注册表，`mount` / `form` 是数据面的挂载与解析，`domain` 是 `storage-domain`
 * 行经声明合并（`StorageForms`）挂上来的那一面——它出现在这里是**上游真面的一部分**，不是我们加的。
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type StorageCovered = AssertTrue<AssertCovered<StorageHub, Storage>>;

@Injectable()
export abstract class Storage {
  abstract readonly backend: StorageHub["backend"];

  abstract readonly mount: StorageHub["mount"];

  abstract readonly form: StorageHub["form"];

  abstract readonly domain: StorageHub["domain"];
}
