// Slot 注册表契约：成员按上游 `SlotRegistry` 的公开面裁；实现由 `SlotsDefault` 组合 `SlotCore` 提供。
import type { SlotComponent, SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { Injectable } from "@morlay/zephyr";

type Key = Parameters<SlotRegistry["entries"]>[0];

@Injectable()
export abstract class Slots {
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
    options: Omit<Parameters<SlotRegistry["register"]>[0], "name"> & { readonly name: K },
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

  /** 读当前装着的 scope adapter（没有就是 `undefined`）：装配期用它决定要不要装兜底实现。 */
  abstract scope(scope: string): unknown;
}
