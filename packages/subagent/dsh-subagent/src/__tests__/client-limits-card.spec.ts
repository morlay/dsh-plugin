/**
 * 限额卡控制器的行为：真的 `SettingsFormModel`（fork 的 ui-primitives）+ 假 scope。
 *
 * 假 scope 只在内存里模拟 host 的共享配置表单（快照 / 订阅 / 一次带 revision 栅栏的写），所以这些用例
 * 不碰远程面、不碰装配——它们盯的是「草稿怎么变成 path op」这条接缝：
 * 输入只改草稿、非法草稿挡保存、保存按 staged 顺序发 op、host 拒绝保留草稿、丢弃不发写。
 */

import { describe, expect, it, vi } from "vitest";
import type {
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
} from "@morlay/dsh-client-ui-primitives/client";
import {
  SubagentLimitsCardController,
  type SubagentLimitsSettings,
} from "../client/subagent-limits-card-controller.ts";

type Snapshot = SettingsFormScopeSnapshot<SubagentLimitsSettings>;
type PathOps = readonly SettingsFormPathOp[];

/** 假 scope：快照可读，写被记录，并在「host 接受」时按 op 更新读写两层后通知订阅者。 */
class FakeScope implements SettingsFormScope<SubagentLimitsSettings> {
  /** 每次保存发出的 path op（按保存顺序）。 */
  readonly writes: PathOps[] = [];
  /** 每次保存带的 revision 栅栏。 */
  readonly fences: (number | undefined)[] = [];
  /** 让 host 拒绝下一次写。 */
  accepted = true;

  #snapshot: Snapshot;
  readonly #listeners = new Set<() => void>();

  constructor(overrides: Partial<Snapshot> = {}) {
    this.#snapshot = {
      status: "ready",
      value: { maxDepth: 1, maxActiveSubagents: 8 },
      base: { maxDepth: 1, maxActiveSubagents: 8 },
      user: undefined,
      writable: true,
      revision: 7,
      ...overrides,
    };
  }

  getSnapshot(): Snapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  mutate(ops: PathOps, expectedRevision?: number): Promise<boolean> {
    this.writes.push(ops);
    this.fences.push(expectedRevision);
    if (!this.accepted) return Promise.resolve(false);
    const section = { ...(this.#snapshot.value as Record<string, unknown> | undefined) };
    const user = { ...(this.#snapshot.user as Record<string, unknown> | undefined) };
    for (const op of ops) {
      const field = op.path[0]!;
      if (op.op === "set") {
        section[field] = op.value;
        user[field] = op.value;
      } else {
        Reflect.deleteProperty(user, field);
        section[field] = (this.#snapshot.base as Record<string, unknown> | undefined)?.[field];
      }
    }
    this.#snapshot = {
      ...this.#snapshot,
      // 读写两层都是按字段名拼出来的普通对象，只有这里知道它满足那个段形状。
      value: section as unknown as SubagentLimitsSettings,
      user,
      revision: (this.#snapshot.revision ?? 0) + 1,
    };
    for (const listener of this.#listeners) listener();
    return Promise.resolve(true);
  }
}

/** 装上控制器并取到槽位渲染器会用的那份快照。 */
function mounted(scope: FakeScope) {
  const face = new SubagentLimitsCardController(scope).inject();
  return { face, state: () => face.hooks.subagentLimitsCard.getSnapshot() };
}

describe("限额卡控制器", () => {
  it("初值来自生效层：不脏、无覆盖", () => {
    const { state } = mounted(new FakeScope());

    expect(state()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      invalid: false,
      failed: false,
    });
    expect(state().maxDepth).toEqual({ text: "1", overridden: false, invalid: false });
    expect(state().maxActiveSubagents.text).toBe("8");
  });

  it("输入只落在草稿上：保存前 host 一个写都没收到", () => {
    const scope = new FakeScope();
    const { face, state } = mounted(scope);

    face.edit("maxDepth", "3");

    expect(state()).toMatchObject({ dirty: true, invalid: false });
    expect(state().maxDepth).toEqual({ text: "3", overridden: true, invalid: false });
    expect(scope.writes).toEqual([]);
    expect(scope.getSnapshot().value).toEqual({ maxDepth: 1, maxActiveSubagents: 8 });
  });

  it("非法草稿留在屏幕上并挡下保存", () => {
    const scope = new FakeScope();
    const { face, state } = mounted(scope);

    face.edit("maxDepth", "-1");
    face.save();

    expect(state()).toMatchObject({ dirty: true, invalid: true });
    expect(state().maxDepth).toMatchObject({ text: "-1", invalid: true });
    expect(scope.writes).toEqual([]);
  });

  it("只接受该字段下限之上的整数", () => {
    const { face, state } = mounted(new FakeScope());

    face.edit("maxActiveSubagents", "0");
    expect(state().maxActiveSubagents.invalid).toBe(true);
    face.edit("maxActiveSubagents", "2.5");
    expect(state().maxActiveSubagents.invalid).toBe(true);
    face.edit("maxActiveSubagents", "abc");
    expect(state().maxActiveSubagents.invalid).toBe(true);
    face.edit("maxActiveSubagents", "1");
    expect(state().maxActiveSubagents.invalid).toBe(false);
    // 深度的下限是 0（禁用子代理），所以 0 合法。
    face.edit("maxDepth", "0");
    expect(state().maxDepth.invalid).toBe(false);
  });

  it("保存把草稿变成 path op，并带读回时的 revision 栅栏", async () => {
    const scope = new FakeScope();
    const { face, state } = mounted(scope);

    face.edit("maxDepth", "3");
    face.edit("maxActiveSubagents", "12");
    face.save();

    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });
    expect(scope.writes[0]).toEqual([
      { op: "set", path: ["maxDepth"], value: 3 },
      { op: "set", path: ["maxActiveSubagents"], value: 12 },
    ]);
    expect(scope.fences[0]).toBe(7);
    await vi.waitFor(() => {
      expect(state()).toMatchObject({ dirty: false, saving: false, failed: false });
    });
    expect(state().maxDepth.text).toBe("3");
    expect(state().maxActiveSubagents.text).toBe("12");
  });

  it("host 拒绝时保留草稿并报失败", async () => {
    const scope = new FakeScope();
    scope.accepted = false;
    const { face, state } = mounted(scope);

    face.edit("maxDepth", "3");
    face.save();

    await vi.waitFor(() => {
      expect(state().failed).toBe(true);
    });
    expect(state()).toMatchObject({ dirty: true, saving: false });
    expect(state().maxDepth.text).toBe("3");
  });

  it("丢弃草稿：回到生效值，且 host 一个写都没收到", () => {
    const scope = new FakeScope();
    const { face, state } = mounted(scope);

    face.edit("maxDepth", "3");
    face.edit("maxActiveSubagents", "abc");
    face.discard();

    expect(state()).toMatchObject({ dirty: false, invalid: false });
    expect(state().maxDepth.text).toBe("1");
    expect(state().maxActiveSubagents.text).toBe("8");
    expect(scope.writes).toEqual([]);
  });

  it("恢复默认草稿保存时发 unset，把字段交回组成层", async () => {
    const scope = new FakeScope({ user: { maxDepth: 3 } });
    const { face, state } = mounted(scope);

    expect(state().maxDepth.overridden).toBe(true);

    face.resetField("maxDepth");
    face.save();

    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });
    expect(scope.writes[0]).toEqual([{ op: "unset", path: ["maxDepth"] }]);
    expect(state().maxDepth).toMatchObject({ text: "1", overridden: false });
  });

  it("只读文档：保存不发写", () => {
    const scope = new FakeScope({ writable: false });
    const { face, state } = mounted(scope);

    face.edit("maxDepth", "3");
    face.save();

    expect(state().writable).toBe(false);
    expect(scope.writes).toEqual([]);
  });

  it("host 不服务这个 namespace 时 available=false（卡片据此只画不可用那一行）", () => {
    const { state } = mounted(
      new FakeScope({ status: "unavailable", value: undefined, revision: undefined }),
    );

    expect(state()).toMatchObject({ available: false, dirty: false, invalid: false });
  });
});
