/**
 * 设置卡片控制器的行为：假的 `SettingsFormScope`（内存里模拟 host 的共享配置表单）+ 假的模式清单与模型目录。
 *
 * 盯的是这条接缝：**选择器只改草稿，保存才按 staged 顺序发一次 `mutate` 的 path op**（`['models', <模式>]`
 * 的 set / unset），以及目录与清单读不到时状态怎么呈现。不碰 React、不碰远程面——那些是渲染与装配的事。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelProviderGroup } from "@deepseek-ai/dsh-api-remotes/client";
import type {
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormScopeSnapshot,
} from "@morlay/dsh-client-ui-primitives/client";
import { describe, expect, it, vi } from "vitest";
import {
  ModelDefaultsCardController,
  type ModelDefaultsSources,
  type SessionModeSettings,
} from "../client/model-defaults-card-controller.ts";
import type { SessionModeRoster } from "../shared.ts";

type Snapshot = SettingsFormScopeSnapshot<SessionModeSettings>;
type PathOps = readonly SettingsFormPathOp[];

/** 假 scope：快照可读，写被记录，并在「host 接受」时按 op 更新读写两层后通知订阅者。 */
class FakeScope implements SettingsFormScope<SessionModeSettings> {
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
      value: { models: { chat: { provider: "ollama", model: "chat-model" } } },
      base: {},
      user: { models: { chat: { provider: "ollama", model: "chat-model" } } },
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
    const value = models(this.#snapshot.value);
    const user = models(this.#snapshot.user);
    const base = models(this.#snapshot.base);
    for (const op of ops) {
      const mode = op.path[1]!;
      if (op.op === "set") {
        value[mode] = op.value;
        user[mode] = op.value;
      } else {
        Reflect.deleteProperty(user, mode);
        value[mode] = base[mode];
      }
    }
    this.#snapshot = {
      ...this.#snapshot,
      // 两层都是按模式 id 拼出来的普通对象，只有这里知道它满足那个段形状。
      value: { models: value } as unknown as SessionModeSettings,
      user: { models: user },
      revision: (this.#snapshot.revision ?? 0) + 1,
    };
    for (const listener of this.#listeners) listener();
    return Promise.resolve(true);
  }
}

/** 快照那两层的 `models`（层是原始 JSON 形状）。 */
function models(layer: unknown): Record<string, unknown> {
  return { ...(layer as { models?: Record<string, unknown> } | null | undefined)?.models };
}

const ROSTER: SessionModeRoster = {
  default: "coding",
  modes: [
    { id: "coding", name: "编码模式", description: "功能完整的编码 Agent" },
    { id: "chat", name: "对话模式" },
  ],
};

const OLLAMA: ModelProviderGroup = {
  id: "ollama",
  name: "Ollama Cloud",
  models: [
    {
      id: "coding-model",
      name: "Coding Model",
      reasoning: { efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] },
    },
    { id: "chat-model", name: "Chat Model" },
  ],
};

const VENDOR: ModelProviderGroup = {
  id: "vendor",
  name: "Vendor",
  models: [{ id: "vendor-model", name: "Vendor Model" }],
};

/** 两条外部读取的假实现；给 `overrides` 就能造出"目录读不到"。 */
function sources(overrides: Partial<ModelDefaultsSources> = {}): ModelDefaultsSources {
  return {
    roster: () => Promise.resolve(ROSTER),
    directory: () => Promise.resolve({ groups: [OLLAMA, VENDOR], failures: [] }),
    ...overrides,
  };
}

/** 装上控制器并取到槽位渲染器会用的那份快照。 */
function mounted(scope: FakeScope, from: ModelDefaultsSources = sources()) {
  const face = new ModelDefaultsCardController(scope, from).inject();
  return { face, state: () => face.hooks.modelDefaultsCard.getSnapshot() };
}

/** 等两条读取落地（控制器在构造函数里就发起了）。 */
async function ready(state: () => { rosterStatus: string; directoryStatus: string }) {
  await vi.waitFor(() => {
    expect(state().rosterStatus).toBe("ready");
    expect(state().directoryStatus).toBe("ready");
  });
}

/** 只等清单落地：目录那边故意读不到时用。 */
async function rosterReady(state: () => { rosterStatus: string }) {
  await vi.waitFor(() => {
    expect(state().rosterStatus).toBe("ready");
  });
}

describe("默认模型卡控制器：列模式", () => {
  it("每个模式一行：名字、说明与当前生效值都来自清单与设置", async () => {
    const { state } = mounted(new FakeScope());
    await ready(state);

    expect(state().rows).toEqual([
      {
        id: "coding",
        name: "编码模式",
        description: "功能完整的编码 Agent",
        overridden: false,
        dirty: false,
        invalid: false,
      },
      {
        id: "chat",
        name: "对话模式",
        value: { provider: "ollama", model: "chat-model" },
        overridden: true,
        dirty: false,
        invalid: false,
      },
    ]);
    expect(state().directory.map((group) => group.id)).toEqual(["ollama", "vendor"]);
    expect(state()).toMatchObject({ available: true, writable: true, dirty: false, invalid: false });
  });

  it("清单读不到时列不出模式，但设置本身仍算可用", async () => {
    const { state } = mounted(
      new FakeScope(),
      sources({ roster: () => Promise.reject(new Error("offline")) }),
    );
    await vi.waitFor(() => {
      expect(state().rosterStatus).toBe("error");
    });

    expect(state().rows).toEqual([]);
    expect(state().available).toBe(true);
  });

  it("模型目录读不到时把落点报出来（当前值仍看得见，仍能恢复默认）", async () => {
    const { state, face } = mounted(
      new FakeScope(),
      sources({ directory: () => Promise.reject(new Error("offline")) }),
    );
    await vi.waitFor(() => {
      expect(state().directoryStatus).toBe("error");
    });
    await rosterReady(state);

    expect(state().directory).toEqual([]);
    expect(state().rows[1]?.value).toEqual({ provider: "ollama", model: "chat-model" });

    face.resetMode("chat");
    expect(state().rows[1]).toMatchObject({ overridden: true, dirty: true });
  });

  it("部分失败：读不到的那几个 provider 报出来，其余照样可选", async () => {
    const { state } = mounted(
      new FakeScope(),
      sources({ directory: () => Promise.resolve({ groups: [OLLAMA], failures: ["Vendor"] }) }),
    );
    await ready(state);

    expect(state().directoryFailures).toEqual(["Vendor"]);
    expect(state().directory.map((group) => group.id)).toEqual(["ollama"]);
  });
});

describe("默认模型卡控制器：草稿与写", () => {
  it("选 provider + model：保存按 `['models', <模式>]` 写一条 set（带 revision 栅栏）", async () => {
    const scope = new FakeScope();
    const { state, face } = mounted(scope);
    await ready(state);

    face.setProvider("coding", "vendor");
    expect(state().rows[0]).toMatchObject({ value: { provider: "vendor", model: "" }, invalid: true });
    expect(state()).toMatchObject({ dirty: true, invalid: true });
    // 半成品不许保存：这一发不发写。
    face.save();
    await Promise.resolve();
    expect(scope.writes).toEqual([]);

    face.setModel("coding", "vendor-model");
    expect(state().rows[0]).toMatchObject({
      value: { provider: "vendor", model: "vendor-model" },
      invalid: false,
    });
    face.save();
    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });

    expect(scope.writes[0]).toEqual([
      { op: "set", path: ["models", "coding"], value: { provider: "vendor", model: "vendor-model" } },
    ]);
    expect(scope.fences).toEqual([7]);
    expect(state().dirty).toBe(false);
  });

  it("档位：模型声明了才给，换 provider 就丢掉旧档位（档位是模型自带的）", async () => {
    const scope = new FakeScope();
    const { state, face } = mounted(scope);
    await ready(state);

    face.setProvider("coding", "ollama");
    face.setModel("coding", "coding-model");
    face.setEffort("coding", "high");
    face.save();
    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });

    expect(scope.writes[0]).toEqual([
      {
        op: "set",
        path: ["models", "coding"],
        value: { provider: "ollama", model: "coding-model", reasoningEffort: "high" },
      },
    ]);

    // 换 provider：model 与档位一起清掉，这一行回到"还没选模型"。
    face.setProvider("coding", "vendor");
    expect(state().rows[0]?.value).toEqual({ provider: "vendor", model: "" });
  });

  it("清空用 unset：这一行回到装配层那份", async () => {
    const scope = new FakeScope();
    const { state, face } = mounted(scope);
    await ready(state);

    face.resetMode("chat");
    expect(state().rows[1]).toMatchObject({ dirty: true, overridden: true });
    face.save();
    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });

    expect(scope.writes[0]).toEqual([{ op: "unset", path: ["models", "chat"] }]);
    // 装配层那份回到屏幕上的值。
    expect(state().rows[1]?.value).toBeUndefined();
  });

  it("provider 选回「跟全局默认」与「恢复默认」是同一个动作", async () => {
    const scope = new FakeScope();
    const { state, face } = mounted(scope);
    await ready(state);

    face.setProvider("chat", "");
    face.save();
    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });

    expect(scope.writes[0]).toEqual([{ op: "unset", path: ["models", "chat"] }]);
  });

  it("没改的行不写；host 拒绝时保留草稿并报失败", async () => {
    const scope = new FakeScope();
    const { state, face } = mounted(scope);
    await ready(state);

    // 选成与当前生效值一模一样的组合：不算改动，不发写。
    face.setProvider("chat", "ollama");
    face.setModel("chat", "chat-model");
    expect(state().dirty).toBe(false);
    face.save();
    await Promise.resolve();
    expect(scope.writes).toEqual([]);

    scope.accepted = false;
    face.setModel("chat", "coding-model");
    face.save();
    await vi.waitFor(() => {
      expect(state().failed).toBe(true);
    });

    expect(scope.writes).toHaveLength(1);
    // 草稿留着供用户修改：这一行还是"有编辑"。
    expect(state()).toMatchObject({ dirty: true, saving: false });
  });

  it("丢弃丢掉全部草稿，不留写入", async () => {
    const scope = new FakeScope();
    const { state, face } = mounted(scope);
    await ready(state);

    face.setProvider("coding", "vendor");
    expect(state().dirty).toBe(true);

    face.discard();
    expect(state()).toMatchObject({ dirty: false, invalid: false });
    expect(state().rows[0]?.value).toBeUndefined();
    expect(scope.writes).toEqual([]);
  });

  it("只读文档里一个都不发：选择器改了也不算数", async () => {
    const scope = new FakeScope({ writable: false });
    const { state, face } = mounted(scope);
    await ready(state);

    face.setProvider("coding", "vendor");
    face.save();

    expect(state()).toMatchObject({ writable: false, dirty: false });
    expect(scope.writes).toEqual([]);
  });
  it("卡片注册到本行的配置入口（`plugins.row.config`），不占官方分组", async () => {
    const source = await readFile(
      join(process.cwd(), "packages/profile/dsh-session-mode/src/client/index.ts"),
      "utf8",
    );

    // 官方分组 `plugins.item` 由官方那几张设置卡占用；行自己的配置挂在行上。
    expect(source).toContain('"plugins.row.config"');
    expect(source).not.toContain('"plugins.item"');
    // key 与页面 `rowConfigKey(bundle, rowId)` 同拼法：bundle = 本包名，行 id = patch 里插的 `session-mode`。
    expect(source).toContain('export const SESSION_MODE_ROW_CONFIG_KEY = "@morlay/dsh-session-mode#session-mode";');
  });
});
