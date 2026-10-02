import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
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

  // 基础面（`@morlay/dsh-client-ui-primitives`）随 client 行内联：装配里不再有共享 client 行可插。
  it("不插基础面那一行，只装自己要装的行", () => {
    const ids = inserted().map((row) => row.id ?? "");
    expect(ids).not.toContain("ui-primitives-fork");
    expect(ids).not.toContain("ui-conversation-fork");
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
  it("三个模式都不写 `preset`；`chat` 只写着 `allowTools` 三件，`coding` 收窄官方 Office 面", () => {
    const modes = sessionModeRows()[0]?.insert?.[0]?.config?.["modes"] as
      | Record<
          string,
          {
            preset?: string;
            allowTools?: readonly string[];
            denyTools?: readonly string[];
            allowSkills?: readonly string[];
            denySkills?: readonly string[];
          }
        >
      | undefined;

    expect(Object.keys(modes ?? {}).sort()).toEqual(["chat", "coding", "noop"]);
    for (const [id, mode] of Object.entries(modes ?? {})) {
      // 不写 `preset`：选模式不换行清单（用户选的 shipped preset 不被模式覆盖）。
      expect(mode.preset, id).toBeUndefined();
    }
    // `coding` 不设工具白名单（用 preset 的全部工具），只排除官方 Office 组合里那个载荷查询；
    // 技能面按名排除官方那三件（技能目录不列、`skill` 工具加载被拒）。
    expect(modes?.["coding"]?.allowTools).toBeUndefined();
    expect(modes?.["coding"]?.denyTools).toEqual(["load_workspace_dependencies"]);
    expect(modes?.["coding"]?.allowSkills).toBeUndefined();
    expect(modes?.["coding"]?.denySkills).toEqual(["office-docx", "office-pptx", "office-xlsx"]);
    // `chat` 收成提问 + 联网三件，技能与工具名单都不再另配。
    expect(modes?.["chat"]?.allowTools).toEqual(["ask_user_question", "web_search", "web_fetch"]);
    expect(modes?.["chat"]?.denyTools).toBeUndefined();
    expect(modes?.["chat"]?.denySkills).toBeUndefined();
    // `noop` 什么都不配：名单留空 = 不设收窄，装配结果与"没有模式"一致。
    expect(modes?.["noop"]).toMatchObject({ name: "原样模式", role: ["main", "subagent"] });
    expect(Object.keys(modes?.["noop"] ?? {}).sort()).toEqual(["description", "name", "role"]);
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
