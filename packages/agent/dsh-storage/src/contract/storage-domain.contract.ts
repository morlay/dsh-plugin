// storage-domain 契约：令牌按服务语义命名（上游注册名 `storageDomain`）。
//
// **上游的真面不是一个 cordis Service**：`storage-domain` 行的 `apply` 里既
// `domainCtx.provide('storageDomain', facility)`，又把同一份 facility 挂到 `storage.mount("domain", …)` 上——
// 两个名字指向同一个实例（`ctx.storageDomain` / `ctx.storage.domain`）。
// 所以这里的契约面 = `DomainFacility` 的公开成员，成员一个都不能少（缺一个消费方读到 `undefined`）。
import { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import type { DomainSpec } from "@deepseek-ai/dsh-storage-domain";
import { Injectable } from "@morlay/zephyr";
import type { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "storageDomain" })
export abstract class StorageDomain {
  /**
   * 按 spec 打开一个 domain（`spec.name` 为键）。
   *
   * 不变量：同名重复打开由设施侧报 `already-open`；返回的句柄归调用方所有，用 `close()` 关。
   */
  abstract open<S extends DomainSpec>(spec: S): ReturnType<DomainFacility["open"]>;

  /** 按名字取一个已打开的 domain（未打开给 `undefined`）。 */
  abstract get(name: Parameters<DomainFacility["get"]>[0]): ReturnType<DomainFacility["get"]>;

  /** 关掉设施上所有仍开着的 domain（行卸载时用）。 */
  abstract closeAll(): ReturnType<DomainFacility["closeAll"]>;
}

/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type StorageDomainCovered = AssertTrue<AssertCovered<DomainFacility, StorageDomain>>;
