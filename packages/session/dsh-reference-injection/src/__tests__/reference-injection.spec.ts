import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-session";
import type { SkillDefinition } from "@deepseek-ai/dsh-skill";
import { apply } from "../index.ts";
import { fileReferencesIn, skillNamesIn } from "../links.ts";

type Listener = (
  payload: {
    agent: { session: { header: { cwd: string } } };
    messages: UserMessage[];
    signal: AbortSignal;
  },
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>;

function userMessage(text: string, kind = "user"): UserMessage {
  return { content: [{ type: "text", text }], source: { kind } } as unknown as UserMessage;
}

interface FakeFile {
  readonly content: string;
  readonly kind?: "file" | "directory";
  readonly fail?: Error;
  readonly unknownSize?: true;
}

function fakeFs(files: Record<string, FakeFile>): unknown {
  const required = (target: { targetKey: string }): FakeFile => {
    const file = files[target.targetKey];
    if (file === undefined) throw new Error(`no fixture for ${target.targetKey}`);
    return file;
  };
  return {
    resolve: (path: string) => Promise.resolve({ targetKey: path, displayPath: path }),
    stat: (target: { targetKey: string }) => {
      const file = files[target.targetKey];
      if (file === undefined) return Promise.resolve(undefined);
      return Promise.resolve({
        version: "v1",
        type: file.kind ?? "file",
        ...(file.unknownSize === true ? {} : { size: Buffer.byteLength(file.content) }),
      });
    },
    readText: async (target: { targetKey: string }) => {
      const file = required(target);
      if (file.fail !== undefined) throw file.fail;
      return file.content;
    },
    streamText: async (target: { targetKey: string }) => {
      const file = required(target);
      if (file.fail !== undefined) throw file.fail;
      return (async function* () {
        yield file.content;
      })();
    },
  };
}

function skill(name: string, userInvocable = true): SkillDefinition {
  return {
    name,
    provider: "local",
    content: `# ${name} 正文`,
    invocation: { userInvocable, modelInvocable: true },
  } as unknown as SkillDefinition;
}

function mount(
  skills: Record<string, SkillDefinition | undefined>,
  files: Record<string, FakeFile> = {},
  withFileSystem = true,
): Listener {
  const listeners: Listener[] = [];
  const fs = fakeFs(files);
  const ctx = {
    on: (_name: string, listener: Listener) => {
      listeners.push(listener);
      return () => {};
    },
    skills: {
      get: (name: string): Promise<SkillDefinition | undefined> => Promise.resolve(skills[name]),
    },
    get: (name: string): unknown => (name === "fs" && withFileSystem ? fs : undefined),
  } as unknown as Context;
  apply(ctx);
  const listener = listeners[0];
  if (listener === undefined) throw new Error("apply registered no pre-step listener");
  return listener;
}

function step(listener: Listener, claimed: UserMessage[]): Promise<PreStepDecision> {
  return listener(
    {
      agent: { session: { header: { cwd: "/w" } } },
      messages: claimed,
      signal: new AbortController().signal,
    },
    () => Promise.resolve({ kind: "enter", messages: claimed }),
  );
}

describe("skillNamesIn", () => {
  it("reads names in first-seen order without duplicates", () => {
    expect(skillNamesIn([userMessage("先 skill:alpha 再 skill:beta，又是 skill:alpha")])).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("ignores other sources, other schemes and code", () => {
    expect(skillNamesIn([userMessage("skill:alpha", "tool")])).toEqual([]);
    expect(skillNamesIn([userMessage("见 file:src/a.ts 与 `/alpha`")])).toEqual([]);
    expect(skillNamesIn([userMessage("```\nskill:alpha\n```")])).toEqual([]);
  });

  it("reads every reference form", () => {
    expect(skillNamesIn([userMessage("skill:beta")])).toEqual(["beta"]);
    expect(skillNamesIn([userMessage("@skill:gamma")])).toEqual(["gamma"]);
    expect(skillNamesIn([userMessage("[load](skill:delta)")])).toEqual(["delta"]);
    expect(skillNamesIn([userMessage("@[load](skill:epsilon)")])).toEqual(["epsilon"]);
    expect(skillNamesIn([userMessage("`skill:zeta`")])).toEqual(["zeta"]);
  });
});

describe("fileReferencesIn", () => {
  it("reads @-prefixed paths in first-seen order without duplicates", () => {
    expect(fileReferencesIn([userMessage("@src/a.ts 与 @src/b.ts，又是 @src/a.ts")])).toEqual([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
  });

  // 选择器对含空格的路径落引号 mention（`formatFileMention`），注入必须认同一形态。
  it("reads a quoted mention as one path", () => {
    expect(fileReferencesIn([userMessage('看 @"my file.ts" 与 @"dir/my file.ts"#L2-L3')])).toEqual([
      { path: "my file.ts" },
      { path: "dir/my file.ts", lineStart: 2, lineEnd: 3 },
    ]);
  });

  it("keeps the line window and drops the column", () => {
    expect(fileReferencesIn([userMessage("@src/a.ts:12")])).toEqual([
      { path: "src/a.ts", lineStart: 12 },
    ]);
    expect(fileReferencesIn([userMessage("@src/a.ts:12:5")])).toEqual([
      { path: "src/a.ts", lineStart: 12 },
    ]);
    expect(fileReferencesIn([userMessage("@src/a.ts#L12-L40")])).toEqual([
      { path: "src/a.ts", lineStart: 12, lineEnd: 40 },
    ]);
    expect(fileReferencesIn([userMessage("@[open](src/a.ts#L3)")])).toEqual([
      { path: "src/a.ts", lineStart: 3 },
    ]);
  });

  it("ignores non-@ forms, other protocols and code", () => {
    expect(fileReferencesIn([userMessage("[open](src/a.ts)")])).toEqual([]);
    expect(fileReferencesIn([userMessage("file:src/a.ts")])).toEqual([]);
    expect(fileReferencesIn([userMessage("@skill:alpha")])).toEqual([]);
    expect(fileReferencesIn([userMessage("见 `@src/a.ts`")])).toEqual([]);
    expect(fileReferencesIn([userMessage("```\n@src/a.ts\n```")])).toEqual([]);
    expect(fileReferencesIn([userMessage("@src/a.ts", "tool")])).toEqual([]);
  });
});

const TWO_LINES = "import a\nconst b = 1\n";

function injectedText(decision: PreStepDecision, index: number): string {
  if (decision.kind !== "enter") throw new Error("expected enter");
  const message = decision.messages[index];
  if (message === undefined) throw new Error(`no message at ${index}`);
  const block = message.content[0];
  if (block === undefined || block.type !== "text") throw new Error("expected one text block");
  return block.text;
}

function envelope(path: string, body: readonly string[]): string {
  return [
    "<path>" + path + "</path>",
    "<type>file</type>",
    "<content>",
    ...body,
    "</content>",
  ].join("\n");
}

describe("file content injection", () => {
  it("injects the read tool envelope for an existing @path", async () => {
    const listener = mount({}, { "src/a.ts": { content: TWO_LINES } });
    const decision = await step(listener, [userMessage("看 @src/a.ts 的实现")]);
    expect(decision.kind).toBe("enter");
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(decision.messages).toHaveLength(2);
    const injected = decision.messages[1]!;
    expect(injected.content).toEqual([
      {
        type: "text",
        text: envelope("src/a.ts", [
          "1: import a",
          "2: const b = 1",
          "",
          "(End of file - total 2 lines)",
        ]),
      },
    ]);
    expect(injected.source).toMatchObject({ kind: "file-reference", path: "src/a.ts" });
  });

  it("honors the referenced line window", async () => {
    const listener = mount({}, { "src/a.ts": { content: TWO_LINES } });
    expect(injectedText(await step(listener, [userMessage("@src/a.ts#L1-L1")]), 1)).toBe(
      envelope("src/a.ts", [
        "1: import a",
        "",
        "(Showing lines 1-1 of 2. Use offset=2 to continue.)",
      ]),
    );
    expect(injectedText(await step(listener, [userMessage("@src/a.ts:2")]), 1)).toBe(
      envelope("src/a.ts", ["2: const b = 1", "", "(End of file - total 2 lines)"]),
    );
  });

  it("caps one long line and the whole window the way the read tool does", async () => {
    const long = mount({}, { "src/long.ts": { content: `${"x".repeat(3000)}\n` } });
    expect(injectedText(await step(long, [userMessage("@src/long.ts")]), 1)).toContain(
      "... (line truncated to 2000 chars)",
    );

    const many = mount({}, { "src/many.ts": { content: `${"y".repeat(1000)}\n`.repeat(60) } });
    expect(injectedText(await step(many, [userMessage("@src/many.ts")]), 1)).toContain(
      "(Output capped. Showing lines 1-",
    );
  });

  it("reads a size-less file through the streaming path", async () => {
    const listener = mount({}, { "src/a.ts": { content: TWO_LINES, unknownSize: true } });
    expect(injectedText(await step(listener, [userMessage("@src/a.ts")]), 1)).toContain(
      "1: import a",
    );
  });

  it("injects the envelope of an empty file", async () => {
    const listener = mount({}, { "src/empty.ts": { content: "" } });
    expect(injectedText(await step(listener, [userMessage("@src/empty.ts")]), 1)).toBe(
      envelope("src/empty.ts", ["(End of file - total 0 lines)"]),
    );
  });

  it("injects a file the picker quoted", async () => {
    const listener = mount({}, { "my file.ts": { content: TWO_LINES } });
    expect(injectedText(await step(listener, [userMessage('看 @"my file.ts"')]), 1)).toBe(
      envelope("my file.ts", [
        "1: import a",
        "2: const b = 1",
        "",
        "(End of file - total 2 lines)",
      ]),
    );
  });

  it("keeps an absent, non-file or unreadable reference as plain prose", async () => {
    const cases: readonly (readonly [string, Record<string, FakeFile>])[] = [
      ["@src/missing.ts", {}],
      ["@src", { src: { content: "", kind: "directory" } }],
      ["@src/locked.ts", { "src/locked.ts": { content: "", fail: new Error("binary") } }],
      ["@src/a.ts:9", { "src/a.ts": { content: TWO_LINES } }],
    ];
    for (const [text, files] of cases) {
      const listener = mount({}, files);
      expect(await step(listener, [userMessage(text)])).toEqual({
        kind: "enter",
        messages: [userMessage(text)],
      });
    }
  });

  it("injects the skill body before the referenced file content", async () => {
    const listener = mount({ alpha: skill("alpha") }, { "src/a.ts": { content: TWO_LINES } });
    const decision = await step(listener, [userMessage("skill:alpha 看 @src/a.ts")]);
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(decision.messages.map((message) => (message.source as { kind?: string }).kind)).toEqual([
      "user",
      "skill-invocation",
      "file-reference",
    ]);
  });

  it("keeps references plain when the deployment provides no filesystem", async () => {
    const listener = mount(
      { alpha: skill("alpha") },
      { "src/a.ts": { content: TWO_LINES } },
      false,
    );
    const decision = await step(listener, [userMessage("skill:alpha 看 @src/a.ts")]);
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(decision.messages.map((message) => (message.source as { kind?: string }).kind)).toEqual([
      "user",
      "skill-invocation",
    ]);
  });
});

describe("reference-injection", () => {
  it("injects the rendered skill body for a skill token", async () => {
    const listener = mount({ "code-review": skill("code-review") });
    const claimed = [userMessage("按 skill:code-review 过一遍")];
    const decision = await step(listener, claimed);
    expect(decision.kind).toBe("enter");
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(decision.messages).toHaveLength(2);
    const injected = decision.messages[1]!;
    expect(injected.content[0]).toMatchObject({
      type: "text",
    });
    expect((injected.content[0] as { text: string }).text).toContain(
      '<skill_content name="code-review">',
    );
    expect((injected.source as { kind?: unknown }).kind).toBe("skill-invocation");
  });

  it("keeps an unknown or user-disabled name as plain prose", async () => {
    const unknown = mount({});
    const missing = await step(unknown, [userMessage("skill:nope")]);
    expect(missing).toEqual({ kind: "enter", messages: [userMessage("skill:nope")] });

    const disabled = mount({ nope: skill("nope", false) });
    const kept = await step(disabled, [userMessage("skill:nope")]);
    expect(kept.kind).toBe("enter");
    if (kept.kind !== "enter") throw new Error("expected enter");
    expect(kept.messages).toHaveLength(1);
  });

  it("injects one message per distinct name", async () => {
    const listener = mount({
      alpha: skill("alpha"),
      beta: skill("beta"),
    });
    const decision = await step(listener, [userMessage("skill:alpha 与 skill:beta")]);
    expect(decision.kind).toBe("enter");
    if (decision.kind !== "enter") throw new Error("expected enter");
    expect(decision.messages.map((message) => (message.source as { name?: string }).name)).toEqual([
      undefined,
      "alpha",
      "beta",
    ]);
  });

  it("leaves a reference-free step and a reject untouched", async () => {
    const listener = mount({ alpha: skill("alpha") });
    expect(await step(listener, [userMessage("普通消息")])).toEqual({
      kind: "enter",
      messages: [userMessage("普通消息")],
    });
    const rejected = await listener(
      {
        agent: { session: { header: { cwd: "/w" } } },
        messages: [userMessage("skill:alpha")],
        signal: new AbortController().signal,
      },
      () => Promise.resolve({ kind: "reject" }),
    );
    expect(rejected).toEqual({ kind: "reject" });
  });
});
