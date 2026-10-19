// Slot 注册表契约：成员按上游 `SlotRegistry` 的公开面裁；实现由 `SlotsDefault` 组合 `SlotCore` 提供。
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

  abstract installScope(
    scope: Parameters<SlotRegistry["installScope"]>[0],
    adapter: Parameters<SlotRegistry["installScope"]>[1],
  ): void;

  abstract provideRoot(contribution: Parameters<SlotRegistry["provideRoot"]>[0]): () => void;

  abstract register(
    options: Parameters<SlotRegistry["register"]>[0],
    component: Parameters<SlotRegistry["register"]>[1],
  ): () => void;

  abstract registerFactory(
    options: Parameters<SlotRegistry["registerFactory"]>[0],
    factory: Parameters<SlotRegistry["registerFactory"]>[1],
  ): () => void;

  abstract renderSlot(key: Key, owner: unknown): ReturnType<SlotRegistry["renderSlot"]>;

  abstract snapshot(root?: string): ReturnType<SlotRegistry["snapshot"]>;

  abstract subscribe(key: Key, fn: () => void): () => void;
}
