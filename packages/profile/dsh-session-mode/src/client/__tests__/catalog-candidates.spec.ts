// 配置页的名单候选（工具名 / 技能名 / 上游 policy 名）：前两个**只有 host 侧有全局视图**——工具清单在
// `ctx.tools` 里，技能在客户端却只有按会话的 `remote.skills.list`。所以本包自己开一条 Remote 面
// （host 半 `../catalog.ts` 提供服务、贡献常量 `../catalog-remote.ts`、client 半 mount 它），把读数登记成
// 具名候选源，由 schema 上名单字段的 `role('select', { source })` 认领（标签输入因此聚焦就有候选）。

import { Context } from "@deepseek-ai/cordis";
import type { SelectOption, SelectSpec } from "@morlay/dsh-client-ui-primitives/client";
import { describe, expect, it } from "vitest";
import { CATALOG_NS, SESSION_MODE_CATALOG_REMOTE } from "@morlay/dsh-session-mode/testing";
import { SessionModeCatalog } from "@morlay/dsh-session-mode/testing";
import { POLICY_NAMES } from "@morlay/dsh-session-mode";
import { apply } from "../index.ts";

// host 半的语境：只有这次要读的那两个服务，其余照空。
function hostBench(services: Record<string, unknown>): Context {
  const ctx = new Context();
  for (const [name, value] of Object.entries(services)) ctx.provide(name, value as never);
  return ctx;
}

describe("配置页的名单候选 · host 半的目录面", () => {
  it("工具名取全局层并并入每个活跃 agent 的可见面（同名只留一次）", async () => {
    const ctx = hostBench({
      tools: {
        schemas: (agent?: unknown) =>
          agent === undefined ? [{ name: "全局工具" }] : [{ name: "read" }, { name: "全局工具" }],
      },
      agents: { list: () => [{ id: "s1" }] },
    });

    await expect(new SessionModeCatalog(ctx).remoteExportList()).resolves.toMatchObject({
      tools: ["全局工具", "read"],
      skills: [],
    });
  });

  it("技能名按 agent 的收口与工作目录扫（工作区技能要 `cwd` 才看得到）", async () => {
    const seen: (string | undefined)[] = [];
    const ctx = hostBench({
      skills: {
        list: async (options?: { cwd?: string }) => {
          seen.push(options?.cwd);
          return options?.cwd === undefined
            ? [{ name: "system-skill" }]
            : [{ name: "system-skill" }, { name: "workspace-skill" }];
        },
      },
      agents: { list: () => [{ id: "s1", session: { header: { cwd: "/work" } } }] },
    });

    await expect(new SessionModeCatalog(ctx).remoteExportList()).resolves.toMatchObject({
      skills: ["system-skill", "workspace-skill"],
    });
    // 两次读：一次全局层（不带 cwd），一次按这个 agent 的收口与工作目录。
    expect(seen).toEqual([undefined, "/work"]);
  });

  it("服务不在场（极简装配）或没有活跃 agent 时给空清单，不炸", async () => {
    await expect(new SessionModeCatalog(hostBench({})).remoteExportList()).resolves.toEqual({
      tools: [],
      skills: [],
    });
  });
});

interface Registered {
  name: string;
  spec: SelectSpec;
}

// 一套最小的 client 面：提示面记账、`remote` 只提供 mount 与事件订阅，`remote.sessionModeCatalog` 是
// mount 完成后由 gateway 注册的那个命名空间服务（替身直接在场）。
function clientBench(options: { mount?: boolean } = {}) {
  const sources: Registered[] = [];
  const mounted: unknown[] = [];
  let refreshes = 0;
  const services: Record<string, unknown> = {
    schemaFormHints: {
      describe: () => () => {},
      source: (name: string, spec: SelectSpec) => {
        sources.push({ name, spec });
        return () => {};
      },
      suggestKeys: () => () => {},
      subscribe: () => () => {},
      select: () => () => {},
      refresh: () => {
        refreshes += 1;
      },
    },
    remote: {
      $on: () => () => {},
      ...(options.mount === false
        ? {}
        : {
            $mount: (contribution: unknown) => {
              mounted.push(contribution);
              return Promise.resolve(() => {});
            },
          }),
    },
    "remote.sessionModeCatalog": {
      list: () =>
        Promise.resolve({ ok: true, value: { tools: ["read", "write"], skills: ["commit"] } }),
    },
  };
  const ctx = {
    get: (name: string) => services[name],
    effect: (effect: () => unknown) => effect(),
    // 与 cordis 一致：inject 的服务缺席时不执行工厂；在时把服务挂在 scope 上。
    inject: (names: string[], factory: (scope: unknown) => unknown) => {
      if (names.some((name) => services[name] === undefined)) return;
      factory({ ...ctx, ...services });
    },
    slots: { register: () => () => {} },
    locale: { bind: () => (key: string) => key, register: () => {} },
  };
  return { ctx, sources, mounted, refreshes: () => refreshes };
}

// 等到 mount 与目录取回（`$mount().then(...)` 是异步的）。
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const optionsOf = (b: ReturnType<typeof clientBench>, name: string): readonly SelectOption[] =>
  b.sources.find((entry) => entry.name === name)?.spec.options(() => undefined) ?? [];

describe("配置页的名单候选 · client 半的具名源", () => {
  it("mount 这条目录面，并把读数登记成 `catalog-tools` / `catalog-skills` 两个具名源", async () => {
    const b = clientBench();
    apply(b.ctx as never);
    await settled();

    // mount 的正是本包那份贡献（命名空间与 host 侧服务键一致）。
    expect(b.mounted).toEqual([SESSION_MODE_CATALOG_REMOTE]);
    expect(SESSION_MODE_CATALOG_REMOTE.descriptors[0]?.namespace).toBe(CATALOG_NS);
    expect(optionsOf(b, "catalog-tools")).toEqual([{ value: "read" }, { value: "write" }]);
    expect(optionsOf(b, "catalog-skills")).toEqual([{ value: "commit" }]);
    // 候选晚到：注册后要通知页面重投影一次。
    expect(b.refreshes()).toBeGreaterThan(0);
  });

  it("policy 名是一份封闭名单（`shared.ts`），不经那条目录面", async () => {
    const b = clientBench({ mount: false });
    apply(b.ctx as never);
    await settled();

    expect(b.mounted).toEqual([]);
    expect(optionsOf(b, "policies")).toEqual(POLICY_NAMES.map((value) => ({ value })));
    // 工具 / 技能没有目录面就没有候选：字段退回自由输入，不炸页面。
    expect(optionsOf(b, "catalog-tools")).toEqual([]);
    expect(optionsOf(b, "catalog-skills")).toEqual([]);
  });
});
