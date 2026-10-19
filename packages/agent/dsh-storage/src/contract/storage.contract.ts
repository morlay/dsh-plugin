// storage 聚合面契约：令牌按服务语义命名（上游注册名 `storage`）。
import type { Storage as StorageHub } from "@deepseek-ai/dsh-storage";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

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

