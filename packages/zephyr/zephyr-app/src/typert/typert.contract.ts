// Typert 运行时注册表契约（上游 `TypertRegistry` 的服务面）。
//
// **覆盖守卫**：上游服务面有而本契约没列出的成员，编译期必须为空——契约少一条，
// 上游 `ApiSessionController` 会在用到它的那一刻读到 `undefined`（装的时候什么都看不出来）。
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";
import type TypertRegistry from "@deepseek-ai/dsh-typert-registry";

@Injectable()
export abstract class Typert {
  abstract readonly local: TypertRegistry["local"];

  abstract readonly lookups: TypertRegistry["lookups"];

  abstract readonly contexts: TypertRegistry["contexts"];

  /**
   * 资源读者注册表：`@Remote` 方法声明它访问哪些资源（会话 / 工作区…），准入按它判定。
   *
   * 上游 `ApiSessionController` 直接读 `ctx.typert.resources`；契约少了这一条，
   * 它装得上却在第一次资源准入时读到 `undefined`。
   */
  abstract readonly resources: TypertRegistry["resources"];

  /**
   * 登记一个 remote namespace 的宿主实现（上游 `TypertRegistry.register`）。
   *
   * 这是「前后端同一份契约」的写法：宿主侧 `register({ namespace, methods })`，
   * 客户端侧用 `@RemoteGroup` 的契约方法调它。
   */
  abstract register(contribution: Parameters<TypertRegistry["register"]>[0]): ReturnType<TypertRegistry["register"]>;

  /** 登记过的 remote 视图（`namespace/method` → 描述）。 */
  abstract readonly remotes: TypertRegistry["remotes"];

  /**
   * 一个端点的调用描述。
   * @param endpoint - `namespace/method`。
   * @returns 描述；未登记时 `undefined`。
   */
  abstract get(endpoint: Parameters<TypertRegistry["get"]>[0]): ReturnType<TypertRegistry["get"]>;

  /** 全部端点的调用描述（按登记顺序）。 */
  abstract list(): ReturnType<TypertRegistry["list"]>;

  /**
   * 一个包声明的全部端点描述。
   * @param packageName - 包名。
   * @returns 描述列表。
   */
  abstract getPackage(packageName: Parameters<TypertRegistry["getPackage"]>[0]): ReturnType<TypertRegistry["getPackage"]>;

  /** 全部包名（按登记顺序）。 */
  abstract listPackages(): ReturnType<TypertRegistry["listPackages"]>;

  /**
   * 按 id 取一个 schema 记录。
   * @param id - schema id。
   * @returns 记录；缺失时抛错。
   */
  abstract resolve(id: Parameters<TypertRegistry["resolve"]>[0]): ReturnType<TypertRegistry["resolve"]>;

  /**
   * 一个 schema 记录的 JSON Schema 视图。
   * @param id - schema id。
   * @returns JSON Schema。
   */
  abstract toJSONSchema(id: Parameters<TypertRegistry["toJSONSchema"]>[0]): ReturnType<TypertRegistry["toJSONSchema"]>;
}

/** 覆盖守卫：上游 `TypertRegistry` 有而本契约没列出的成员，编译期必须为空。 */
export type TypertCovered = AssertTrue<AssertCovered<TypertRegistry, Typert>>;
