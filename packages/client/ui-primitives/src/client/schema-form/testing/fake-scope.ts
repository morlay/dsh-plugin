/**
 * 测试用的共享配置表单：内存里模拟 host 的读写两层（快照 / 订阅 / 一次带 revision 栅栏的写）。
 *
 * 它让控制器与草稿模型的用例不碰远程面、不碰装配，只盯「草稿怎么变成写」与「状态怎么投影」。
 */

import type { SettingsPathOpView } from "@deepseek-ai/dsh-api-remotes/client";
import type { ConfigForm, ConfigFormSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";

/** 命名空间段的值。 */
export type Section = Record<string, unknown>;

export class FakeScope implements ConfigForm<Section> {
  /** 每次保存发出的 path op（按保存顺序）。 */
  readonly writes: (readonly SettingsPathOpView[])[] = [];
  /** 每次保存带的 revision 栅栏。 */
  readonly fences: (number | undefined)[] = [];
  /** 让 host 拒绝下一次写。 */
  accepted = true;

  #snapshot: ConfigFormSnapshot<Section>;
  readonly #listeners = new Set<() => void>();

  constructor(overrides: Partial<ConfigFormSnapshot<Section>> = {}) {
    this.#snapshot = {
      status: "ready",
      value: {},
      base: {},
      user: undefined,
      writable: true,
      revision: 7,
      mode: "host",
      ...overrides,
    };
  }

  getSnapshot(): ConfigFormSnapshot<Section> {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  set(field: string, value: unknown): Promise<boolean> {
    return this.mutate([{ op: "set", path: [field], value: value as never }]);
  }

  unset(field: string): Promise<boolean> {
    return this.mutate([{ op: "unset", path: [field] }]);
  }

  mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean> {
    this.writes.push(ops);
    this.fences.push(expectedRevision);
    if (!this.accepted) return Promise.resolve(false);
    const value = structuredClone(this.#snapshot.value ?? {});
    for (const op of ops) {
      const parent = op.path
        .slice(0, -1)
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown> | undefined)?.[key],
          value,
        );
      const leaf = op.path[op.path.length - 1] ?? "";
      if (Array.isArray(parent)) {
        if (op.op === "set") parent[Number(leaf)] = op.value;
        else parent.splice(Number(leaf), 1);
      } else if (op.op === "set") {
        (parent as Section)[leaf] = op.value;
      } else {
        Reflect.deleteProperty(parent as Section, leaf);
      }
    }
    this.#snapshot = {
      ...this.#snapshot,
      value,
      user: value,
      revision: (this.#snapshot.revision ?? 0) + 1,
    };
    this.#publish();
    return Promise.resolve(true);
  }

  /** 从外部改一次读数（模拟另一个界面或 host 的改动）。 */
  publish(overrides: Partial<ConfigFormSnapshot<Section>> = {}): void {
    this.#snapshot = { ...this.#snapshot, ...overrides };
    this.#publish();
  }

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }
}
