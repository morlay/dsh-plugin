import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { sessionModeRows } from "@morlay/dsh-session-mode/rows";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { render } from "../../tsdown.config.ts";

interface Row {
  id?: string;
  name?: string;
  group?: boolean;
  insert?: Row[];
  config?: Record<string, unknown>;
}

// 生成物文本：顶层取一次（`render()` 要向上找仓库根给头注释，是异步的）。
const rendered = await render();

// 本 bundle 的 patch（生成物 = 真源渲染结果）。
function patch(): Row[] {
  return yaml.load(rendered, { schema: entryListSchema }) as Row[];
}

// 顶层 `insert` 里的所有行（生成物只由 insert 段构成）。
function inserted(): Row[] {
  return patch().flatMap((layer) => layer.insert ?? []);
}

function rowById(rows: readonly Row[], id: string): Row {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`patch 里没有 ${id} 这一行`);
  return found;
}

const compose = applyEntryPatches as unknown as (
  data: unknown[],
  patches: unknown[],
  warn: (...args: unknown[]) => void,
) => Row[];

// 本 bundle 的 patch + better-session 的 patch（两者都插了共享 client 行）。
async function layers(): Promise<Row[]> {
  const mine = patch();
  const theirs = yaml.load(
    await readFile(join(process.cwd(), "packages/bundles/better-session/cordis.patch.yml"), "utf8"),
    { schema: entryListSchema },
  ) as Row[];
  return compose([], [...mine, ...theirs], () => {});
}

describe("session-mode-profile 的 bundle patch", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/bundles/session-mode-profile/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(rendered);
    expect(
      rendered.startsWith("# 本文件由 packages/bundles/session-mode-profile/tsdown.config.ts 生成"),
    ).toBe(true);
  });

  it("共享 client 行与别的 bundle 重复插入：两份内容一致（Loader 同 id 复用 Entry，后者胜）", async () => {
    const rows = await layers();

    // `ui-schema-form` 已在 2026-09-28 并进 ui-primitives：共享面只剩这一行。
    for (const [id, name] of [
      ["ui-primitives-fork", "@morlay/dsh-client-ui-primitives"],
    ] as const) {
      const inserted = rows.filter((row) => row.id === id).map((row) => row.name);
      // patch 层不去重（insert 是追加）——去重在 Loader：同 id 复用同一个 Entry，后者胜。
      // 所以这里要守的是"两层写的内容一样"，否则结果就取决于 bundle 顺序。
      expect(inserted, id).toHaveLength(2);
      expect(new Set(inserted), id).toEqual(new Set([name]));
    }
  });
});

describe("host 平面的那几行", () => {
  it("装的是模式行、通道与工具说明；**不再声明自己的 agent preset**、也没有单独一行收口", () => {
    const ids = inserted().map((row) => row.id ?? "");

    for (const id of ["session-mode", "context-assembler"]) {
      expect(ids, id).toContain(id);
    }
    // 收口归 `session-mode` 行内部（模式定义就是它的输入），装配里不再有这一行。
    expect(ids).not.toContain("context-assembler-scope");
    expect(rowById(inserted(), "tool-guidance").name).toBe("@morlay/dsh-tool-guidance");
    expect(rowById(inserted(), "subagent").name).toBe("@morlay/dsh-subagent");
    // 行清单归会话挂着的 shipped preset：我们自己那份（`preset-mode-switch`）已删除，装配里不再有 preset 行。
    expect(inserted().some((row) => row.name === "@deepseek-ai/dsh-agent-preset")).toBe(false);
    for (const id of ["tool-web", "tool-fs", "tool-bash", "plan-mode", "compaction-basic"]) {
      expect(ids, id).not.toContain(id);
    }
  });

  it("子代理行不限制 preset：中文回报指引对任意会话生效（不传名单）", () => {
    // 不传 `localizedReturnGuidancePresets`：不配名单 = 不限 preset（官方四个 shipped 也覆盖）。
    expect(rowById(inserted(), "subagent").config).toBeUndefined();
  });
});

describe("模式定义", () => {
  it("两个模式都不写 `preset` 与 `denyTools`：`chat` 写着 `allowTools` 收窄到三件，`coding` 留空（不设收窄）", () => {
    const modes = sessionModeRows()[0]?.insert?.[0]?.config?.["modes"] as
      | Record<
          string,
          { preset?: string; allowTools?: readonly string[]; denyTools?: readonly string[] }
        >
      | undefined;

    expect(Object.keys(modes ?? {}).sort()).toEqual(["chat", "coding"]);
    for (const [id, mode] of Object.entries(modes ?? {})) {
      // 不写 `preset`：选模式不换行清单（用户选的 shipped preset 不被模式覆盖）。
      expect(mode.preset, id).toBeUndefined();
      // 一个模式都不写 `denyTools`：没有要禁的工具。
      expect(mode.denyTools, id).toBeUndefined();
    }
    // `coding` 不设收窄（用 preset 的全部工具）；`chat` 收成提问 + 联网三件。
    expect(modes?.["coding"]?.allowTools).toBeUndefined();
    expect(modes?.["chat"]?.allowTools).toEqual(["ask_user_question", "web_search", "web_fetch"]);
  });

  it("policy 拦截进 config：`coding` 禁掉上游的「先读后改」，写路径的规则留着", () => {
    const modes = sessionModeRows()[0]?.insert?.[0]?.config?.["modes"] as
      | Record<string, { allowPolicies?: readonly string[]; denyPolicies?: readonly string[] }>
      | undefined;

    // 改路径上的上游规则（`fs/edit-intent`）禁用：免"先读后改"。
    expect(modes?.["coding"]?.denyPolicies).toEqual(["fs/edit-intent"]);
    // 写路径上的（`fs/write-intent`）不在黑名单里，也没写白名单：照旧生效（陈旧版本 CAS 那层安全网）。
    expect(modes?.["coding"]?.allowPolicies).toBeUndefined();
    // `chat` 一条 policy 都不配：没有文件工具，两条都碰不到。
    expect(modes?.["chat"]?.denyPolicies).toBeUndefined();
    expect(modes?.["chat"]?.allowPolicies).toBeUndefined();
  });
});
