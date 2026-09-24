/**
 * 自动注册面的行为：哪些行会在自己的配置页上长出表单，行消失时会不会一起收掉。
 *
 * 盯的接缝是**清单 → 槽位注册**：只挑 `autoGenerate` 且在某个 bundle 的行清单里对得上的命名空间；注册用
 * `<bundle 包名>#<行 id>` 这个 key 与兜底 priority（手写项默认 priority 0 会遮住它）；describe 或 bundle
 * 清单变了就差分注册与注销。
 */

import type { BundleInfo, SettingsNamespaceView } from "@deepseek-ai/dsh-api-remotes/client";
import { describe, expect, it, vi } from "vitest";
import { RowRegistration, rowRegistrations } from "../client/rows.ts";
import { fakeDescribe } from "../testing/fake-describe.ts";

function view(ns: string, overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns,
    schema: {},
    value: {},
    autoGenerate: true,
    applies: "live",
    secrets: [],
    revision: 1,
    ...overrides,
  } as SettingsNamespaceView;
}

function bundle(name: string, rowIds: readonly string[]): BundleInfo {
  return {
    name,
    enabled: true,
    installed: true,
    optional: false,
    removable: true,
    rows: rowIds.map((rowId) => ({ rowId, moduleName: rowId })),
    overrides: [],
  } as BundleInfo;
}

interface Registered {
  key: string;
  options: Record<string, unknown>;
}

/** 注册器替身：记录槽位注册与注销，并按行给一个可渲染的槽项。 */
function bench(options: {
  namespaces: readonly SettingsNamespaceView[];
  bundles: readonly BundleInfo[];
  renderable?: (ns: string) => boolean;
}) {
  const registrations: Registered[] = [];
  const disposed: string[] = [];
  const released: string[] = [];
  const describeFace = fakeDescribe(options.namespaces);
  let bundles = options.bundles;
  const bundleListeners = new Set<() => void>();
  const registration = new RowRegistration({
    slots: {
      register: (slotOptions, _component) => {
        const key = String(slotOptions.key);
        registrations.push({ key, options: slotOptions as unknown as Record<string, unknown> });
        return () => {
          disposed.push(key);
        };
      },
    },
    describe: describeFace,
    bundles: () => Promise.resolve(bundles),
    subscribeBundles: (listener) => {
      bundleListeners.add(listener);
      return () => {
        bundleListeners.delete(listener);
      };
    },
    entryFor: (ns) => (options.renderable?.(ns) === false ? undefined : { component: () => null }),
    locale: "settings.schema-form",
    release: (ns) => {
      released.push(ns);
    },
  });
  return {
    registration,
    registrations,
    disposed,
    released,
    describeFace,
    setBundles: (next: readonly BundleInfo[]) => {
      bundles = next;
      for (const listener of bundleListeners) listener();
    },
  };
}

describe("行清单", () => {
  it("只配对「autoGenerate 且属于某个 bundle 行」的命名空间", () => {
    const rows = rowRegistrations(
      [view("subagent-fork"), view("session-mode")],
      [
        bundle("@morlay/dsh-subagent", ["subagent-fork"]),
        bundle("@morlay/dsh-session-mode", ["session-mode"]),
      ],
    );

    expect(rows).toEqual([
      { key: "@morlay/dsh-subagent#subagent-fork", ns: "subagent-fork" },
      { key: "@morlay/dsh-session-mode#session-mode", ns: "session-mode" },
    ]);
  });

  it("自带页面的行（autoGenerate=false）不进来", () => {
    const rows = rowRegistrations(
      [view("custom", { autoGenerate: false })],
      [bundle("b", ["custom"])],
    );

    expect(rows).toEqual([]);
  });

  it("不属于任何 bundle 行的命名空间不进来", () => {
    const rows = rowRegistrations([view("orphan")], [bundle("b", ["other"])]);

    expect(rows).toEqual([]);
  });
});

describe("自动注册", () => {
  it("首次同步就把每个可渲染的行注册到自己的行配置入口", async () => {
    const b = bench({
      namespaces: [view("subagent-fork")],
      bundles: [bundle("@morlay/dsh-subagent", ["subagent-fork"])],
    });

    await b.registration.sync();

    expect(b.registrations).toHaveLength(1);
    expect(b.registrations[0]?.key).toBe("@morlay/dsh-subagent#subagent-fork");
    expect(b.registrations[0]?.options["priority"]).toBe(100);
    expect(b.registrations[0]?.options["locale"]).toBe("settings.schema-form");
  });

  it("渲染不了的行（schema 坏或不是对象）不占入口", async () => {
    const b = bench({
      namespaces: [view("broken"), view("fine")],
      bundles: [bundle("b", ["broken", "fine"])],
      renderable: (ns) => ns !== "broken",
    });

    await b.registration.sync();

    expect(b.registrations.map((entry) => entry.key)).toEqual(["b#fine"]);
  });

  it("命名空间消失时注销，并释放它的控制器", async () => {
    const b = bench({
      namespaces: [view("a"), view("b")],
      bundles: [bundle("pkg", ["a", "b"])],
    });
    await b.registration.sync();

    b.describeFace.publish([view("a")]);
    await b.registration.sync();

    expect(b.disposed).toEqual(["pkg#b"]);
    expect(b.released).toEqual(["b"]);
    const alive = b.registrations
      .map((entry) => entry.key)
      .filter((key) => !b.disposed.includes(key));
    expect(alive).toEqual(["pkg#a"]);
  });

  it("bundle 行清单变了也跟着注销", async () => {
    const b = bench({ namespaces: [view("a")], bundles: [bundle("pkg", ["a"])] });
    await b.registration.sync();

    b.setBundles([bundle("pkg", [])]);
    await b.registration.sync();

    expect(b.disposed).toEqual(["pkg#a"]);
  });

  it("重复同步不会重复注册", async () => {
    const b = bench({ namespaces: [view("a")], bundles: [bundle("pkg", ["a"])] });

    await b.registration.sync();
    await b.registration.sync();

    expect(b.registrations).toHaveLength(1);
  });

  it("收掉自己时把还活着的注册一并注销", async () => {
    const b = bench({ namespaces: [view("a")], bundles: [bundle("pkg", ["a"])] });
    await b.registration.sync();

    b.registration.dispose();

    expect(b.disposed).toEqual(["pkg#a"]);
    expect(b.released).toEqual(["a"]);
  });

  it("并发同步被折叠成一次（bundle 读取只走一趟）", async () => {
    const bundlesRead = vi.fn(() => Promise.resolve([bundle("pkg", ["a"])]));
    const b = bench({ namespaces: [view("a")], bundles: [] });
    const registration = new RowRegistration({
      slots: { register: () => () => {} },
      describe: b.describeFace,
      bundles: bundlesRead,
      subscribeBundles: () => () => {},
      entryFor: () => ({ component: () => null }),
      locale: "settings.schema-form",
      release: () => {},
    });

    await Promise.all([registration.sync(), registration.sync(), registration.sync()]);

    expect(bundlesRead).toHaveBeenCalledTimes(1);
    registration.dispose();
  });
});
