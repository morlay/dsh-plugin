// Slot 注册表契约：成员按上游 `SlotRegistry` 的公开面裁；实现由 `SlotsDefault` 组合 `SlotCore` 提供。
import type { SlotComponent, SlotMap, SlotScopeAdapter } from "@deepseek-ai/dsh-client-ui-slots";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { Injectable } from "@morlay/zephyr";

type Key = Parameters<SlotRegistry["entries"]>[0];

/**
 * 作用域名是 **string**：框架不认识任何具体名字（`session` / `workspace` 都是业务概念）。
 * 名字与它的语义由安装方（业务行）定义，框架只承诺「装了就有、没装给 absent」。
 */
@Injectable({ name: "slots" })
export abstract class Slots {
  /**
   * 台账：本进程里**出现过**的所有位置 key。
   *
   * 上游 `SlotRegistry` 只能按 key 查，不能枚举；装配排查（"某个面的座位到底挂在哪个位置、
   * 有没有挂上"）没有它就只能靠猜。实现在注册与查询时记录 key，卸载不回收——
   * 它记的是"这个位置被谁碰过"，不是"现在有几个条目"。
   * @returns 位置 key 的稳定有序列表。
   */
  abstract keys(): readonly string[];

  /**
   * 某个位置**是否被声明过**（占据者的 `register({ children })` 里写了它）。
   *
   * 与 {@link keys}、`snapshot()` 的区别：`keys()` 只记「被注册或查询碰过的 key」，`snapshot()` 只列
   * **有 occupant** 的位置——声明了但还没有条目的位置在两边都看不见，而装配排查最常问的正是这一句
   * （「上游那段 `register` 到底跑了没」）。
   * @param name - 位置 key。
   * @returns 声明过为 `true`。
   */
  abstract declared(name: string): boolean;

  abstract entries(key: Key): ReturnType<SlotRegistry["entries"]>;

  abstract entriesOfSlot(key: Key): ReturnType<SlotRegistry["entriesOfSlot"]>;

  abstract inject(key: Key, callback: () => unknown): () => void;

  abstract install(renderer: Parameters<SlotRegistry["install"]>[0]): void;

  abstract installLocale(face: Parameters<SlotRegistry["installLocale"]>[0]): void;

  /** 装一个 scope adapter；返回撤销函数（卸载该行时收回）。 */
  abstract installScope(
    scope: Parameters<SlotRegistry["installScope"]>[0],
    adapter: Parameters<SlotRegistry["installScope"]>[1],
  ): () => void;

  /**
   * 订阅某个 scope 的 adapter 变化（装 / 撤 / 替换）。
   *
   * 消费方是「要响应 adapter 晚到或切换」的产品代码（如右栏的在屏会话绑定），不是渲染器——
   * 渲染器那侧用 `scopeRevision`（全局版本号）；业务要的是**精确到 scope** 的通知。
   * @param scope - 作用域名（`session` 等）。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  abstract subscribeScope(scope: string, listener: () => void): () => void;

  abstract provideRoot(contribution: Parameters<SlotRegistry["provideRoot"]>[0]): () => void;

  /**
   * 注册一个位置的组件：`name` 按 `SlotMap` 的 key 收窄（拼错的 key 编不过）。
   *
   * **组件参数用 `SlotComponent<never>`**：上游 `register` 的组件位是「按 key 推断 props」的重载（7 个类型参数），
   * 用 `Parameters<…>[1]` 取会退化成所有 key 的组件类型的**交集**，于是任何具体组件都不可赋值——那是坏 API。
   * 这里显式放宽到「任意组件」：key 由 `name` 校验，props 的逐 key 校验留给装配方自证（上游 renderer 运行时照旧）。
   * 装配器那种「key 只有运行时才知道」的注册走 `registerDynamic`。
   */
  abstract register<K extends keyof SlotMap>(
    options: Omit<Parameters<SlotRegistry["register"]>[0], "name"> & {
      readonly name: K;
      /**
       * list 槽位的条目 id（上游 `register` 的**另一个重载**才带它：`Parameters<…>[0]` 只取到第一个
       * 重载，所以这里显式补上）。运行时对 `kind: 'list'` 的位置是必填的。
       */
      readonly id?: string;
    },
    component: SlotComponent<never>,
  ): () => void;

  /** 动态注册（装配器用）：`name` 与组件都只在运行时才知道，拿不到 `K`，故不带泛型。 */
  abstract registerDynamic(options: Record<string, unknown>, component: unknown): () => void;

  abstract registerFactory(
    options: Parameters<SlotRegistry["registerFactory"]>[0],
    factory: Parameters<SlotRegistry["registerFactory"]>[1],
  ): () => void;

  abstract renderSlot(key: Key, owner: unknown): ReturnType<SlotRegistry["renderSlot"]>;

  abstract snapshot(root?: string): ReturnType<SlotRegistry["snapshot"]>;

  /** 某个位置的单调版本号（`ui-settings-general` 用它判断分节列表变了没）。 */
  abstract getVersion(key: Key): number;

  abstract subscribe(key: Key, fn: () => void): () => void;

  /**
   * 读 scope 的 adapter；**没装返回 `undefined`**（调用方自己决定降级）。
   * @param name - 作用域名（`session` / `session-maybe`）。
   * @returns adapter 或 `undefined`。
   */
  abstract scope(name: string): SlotScopeAdapter | undefined;

  /**
   * 读 scope 的 adapter；**没装就抛**。
   *
   * 「必须要有」的消费方（如在屏会话绑定）用它：装配错误应早暴露，而不是静默降级——
   * 今天九轮排查的正是「静默降级」的代价。
   * @param name - 作用域名。
   * @returns adapter。
   * @throws 该作用域没有 adapter。
   */
  abstract requireScope(name: string): SlotScopeAdapter;
}
