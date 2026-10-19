import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateTypert } from "../index.ts";

// 上下游判据逐条落地：`TypertLookupMap` / `TypertContextMap` 的声明形态、lookup 参数、
// direct 方法的 scope 推导、`@RemoteScope`、普通 JSON 参数与取消通道。
//
// 上游权威实现：
// - `vendor/deepseek-harness/packages/typert/generator/src/analyzer.ts`
//   `lookupDeclarations()` (1519-1554)、`contextDeclarations()` (1556-1581)、
//   `typeMetaMapMembers()` (1583-1598)、`invocationModel()` 的参数/接收者/scope 推导
//   (1150-1261)、`remoteMarker()` 的 `@RemoteScope` 解析 (1414-1432)。
// - `vendor/deepseek-harness/packages/typert/generator/src/model.ts`
//   `InvocationParameterModel` / `InvocationModel.invocation` / `.scope` (116-158)。
// - 上游契约测试：`tests/remote-model.spec.ts` 289-384、803-936、938-946、974-989；
//   `tests/remote-metadata.spec.ts` 143-215；
//   `packages/typert/protocol/tests/remote-info.spec.ts` 109-141、176-184。
//
// 每个 `it` 的注释点名它对齐的上游规则。这里只生成 host / remote-client 文本并断言，
// 不修改被测实现。

interface Fixture {
  /** 协议模块里 `TypertLookupMap` 的成员（整段声明文本）。 */
  readonly lookups?: string;
  /** 协议模块里 `TypertContextMap` 的成员（整段声明文本）。 */
  readonly contexts?: string;
  /** 服务类里的方法声明（整段文本）。 */
  readonly methods: string;
  /** 追加到上游 `types.ts` 的声明（协议模块之外）。 */
  readonly upstreamTypes?: string;
  /** 追加到声明树 `types.d.ts` 的声明。 */
  readonly dtsTypes?: string;
  /** 非协议模块（普通 interface）里的同名 lookup 表成员。 */
  readonly plainLookups?: string;
  /** 非协议模块（普通 interface）里的同名 context 表成员。 */
  readonly plainContexts?: string;
}

interface Generated {
  readonly host: string;
  readonly remote: string;
}

/**
 * 造一个最小上游包 + 声明树。
 *
 * 布局照真实仓库：`<repo>/vendor/<name>` 与 `<repo>/target/dts`；owner 推导靠这两者的相对位置。
 */
async function generate(fixture: Fixture): Promise<Generated> {
  const repo = await mkdtemp(join(tmpdir(), "typert-upstream-context-"));
  const upstreamRoot = join(repo, "vendor", "demo-harness");
  const dtsRoot = join(repo, "target", "dts");
  const pkg = join(upstreamRoot, "packages", "demo", "demo");
  await mkdir(join(pkg, "src"), { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    `${JSON.stringify({ name: "@x/demo", exports: { ".": "./src/index.ts" } })}\n`,
  );
  const meta = [
    "/** Wire identity. */",
    "export type SessionId = string",
    "/** Host Agent. */",
    "export interface Agent { readonly id: SessionId }",
    "/** Host file scope. */",
    "export interface WorkspaceFileScope { readonly sessionId: SessionId; readonly workspaceRoot: string }",
    "/** JSON payload. */",
    "export interface Payload { readonly title: string }",
    "/** Optional JSON payload. */",
    "export interface Options { readonly deep?: boolean }",
    fixture.upstreamTypes ?? "",
    "declare module '@deepseek-ai/dsh-typert-protocol' {",
    "  interface TypertLookupMap {",
    ...(fixture.lookups === undefined ? [] : [fixture.lookups]),
    "  }",
    "  interface TypertContextMap {",
    ...(fixture.contexts === undefined ? [] : [fixture.contexts]),
    "  }",
    "}",
    // 上游 `typeMetaMapMembers()` 只认 `declare module '@deepseek-ai/dsh-typert-protocol'`
    // 里的成员；普通 interface 同名也不参与。
    ...(fixture.plainLookups === undefined
      ? []
      : ["interface TypertLookupMap {", fixture.plainLookups, "}"]),
    ...(fixture.plainContexts === undefined
      ? []
      : ["interface TypertContextMap {", fixture.plainContexts, "}"]),
    "",
  ].join("\n");
  await writeFile(join(pkg, "src", "types.ts"), meta);
  await writeFile(
    join(pkg, "src", "index.ts"),
    [
      "/** Demo service. */",
      "export class Demo extends TypertRemoteService {",
      "  constructor(ctx: Context) { super(ctx, 'demo', { namespace: 'demo' }) }",
      fixture.methods,
      "}",
      "",
    ].join("\n"),
  );
  const dtsPkg = join(dtsRoot, "vendor", "demo-harness", "packages", "demo", "demo", "src");
  await mkdir(dtsPkg, { recursive: true });
  await writeFile(
    join(dtsPkg, "types.d.ts"),
    [
      "export type SessionId = string;",
      "export interface Agent { readonly id: SessionId; }",
      "export interface WorkspaceFileScope { readonly sessionId: SessionId; readonly workspaceRoot: string; }",
      "export interface Payload { readonly title: string; }",
      "export interface Options { readonly deep?: boolean; }",
      fixture.dtsTypes ?? "",
      "",
    ].join("\n"),
  );
  const artifacts = await generateTypert({ upstreamRoot, dtsRoot });
  const files = artifacts[0]?.files ?? [];
  return {
    host: files.find((file) => file.path.endsWith("typert.host.ts"))?.text ?? "",
    remote: files.find((file) => file.path.endsWith("typert.remote-client.ts"))?.text ?? "",
  };
}

/** 截一个 invocation descriptor（从 `id` 到 `sourceLocation`），断言失败时能看清实际产物。 */
function descriptorOf(text: string, id: string): string {
  const start = text.indexOf(`id: '${id}'`);
  if (start < 0) throw new Error(`产物里没有 ${id} 的 descriptor:\n${text.slice(0, 2000)}`);
  const end = text.indexOf("sourceLocation:", start);
  return text.slice(start, end < 0 ? undefined : end);
}

const AGENT_LOOKUP = "    agent: TypertLookup<Agent, SessionId>";
const AGENT_CONTEXT = "    agent: TypertContext<SessionId>";
const SCOPE_LOOKUP = "    workspaceFileScope: TypertLookup<WorkspaceFileScope, SessionId>";

describe("TypertLookupMap / TypertContextMap 声明形态", () => {
  // analyzer.ts `lookupDeclarations()` 1529-1533：值必须是 `TypertLookup<Host, Wire>` 两个实参。
  it("lookup 值必须是 TypertLookup<Host, Wire>（少一个实参 → 生成失败）", async () => {
    await expect(
      generate({
        lookups: "    agent: TypertLookup<Agent>",
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/TypertLookup<Host, Wire>/u);
  });

  // analyzer.ts `lookupDeclarations()` 1529-1530 用 `isTypeMetaSymbol(..., 'TypertLookup')` 判符号，
  // 别名不算。
  it("lookup 值引用别名而不是 TypertLookup 本身 → 生成失败", async () => {
    await expect(
      generate({
        upstreamTypes: "export type AgentLookup = TypertLookup<Agent, SessionId>",
        dtsTypes: "export type AgentLookup = { readonly host: Agent; readonly wire: SessionId };",
        lookups: "    agent: AgentLookup",
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/TypertLookup<Host, Wire>/u);
  });

  // analyzer.ts 1528：`isRemoteSegment(key)`，key 只能含 RPC endpoint segment 字符。
  it("lookup key 含非法字符 → 生成失败", async () => {
    await expect(
      generate({
        lookups: '    "agent id": TypertLookup<Agent, SessionId>',
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/TypertLookupMap key must contain only RPC endpoint segment characters/u);
  });

  // analyzer.ts 1547：`duplicate TypertLookupMap key`。
  it("重复的 lookup key → 生成失败", async () => {
    await expect(
      generate({
        lookups: `${AGENT_LOOKUP}\n${AGENT_LOOKUP}`,
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/duplicate TypertLookupMap key|重复的 TypertLookupMap key/u);
  });

  // analyzer.ts 1548：`Host type ... has more than one Typert lookup`。
  it("同一个宿主类型注册两个 lookup → 生成失败", async () => {
    await expect(
      generate({
        lookups: `${AGENT_LOOKUP}\n    owner: TypertLookup<Agent, SessionId>`,
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/Host type Agent has more than one Typert lookup|有多个 Typert lookup/u);
  });

  // analyzer.ts 1539-1540：Host 必须是具名类型（`symbolAtType` 为 undefined 即失败）。
  it("lookup 的 Host 是内联类型 → 生成失败", async () => {
    await expect(
      generate({
        lookups: "    agent: TypertLookup<{ readonly id: SessionId }, SessionId>",
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/Host must be a named type|必须是命名类型/u);
  });

  // analyzer.ts `contextDeclarations()` 1565-1568：值必须是 `TypertContext<Wire>` 一个实参。
  it("context 值必须是 TypertContext<Wire>（多一个实参 → 生成失败）", async () => {
    await expect(
      generate({
        contexts: "    agent: TypertContext<SessionId, Agent>",
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/TypertContext<Wire>/u);
  });

  // analyzer.ts 1564：context key 也要 `isRemoteSegment`。
  it("context key 含非法字符 → 生成失败", async () => {
    await expect(
      generate({
        contexts: '    "agent id": TypertContext<SessionId>',
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/TypertContextMap key must contain only RPC endpoint segment characters/u);
  });

  // analyzer.ts 1570：`duplicate TypertContextMap key`。
  it("重复的 context key → 生成失败", async () => {
    await expect(
      generate({
        contexts: `${AGENT_CONTEXT}\n${AGENT_CONTEXT}`,
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/duplicate TypertContextMap key|重复的 TypertContextMap key/u);
  });

  // analyzer.ts 1524-1525 / 1560-1561：条目必须是带类型的 property signature；
  // 方法签名（method signature）不是合法条目。
  it("lookup 表用方法签名而不是属性签名 → 生成失败", async () => {
    await expect(
      generate({
        lookups: "    agent(): TypertLookup<Agent, SessionId>",
        methods: "  /** Read. */\n  @Remote\n  read(value: string): string { return value }",
      }),
    ).rejects.toThrow(/TypertLookupMap entries must be required properties/u);
  });

  // analyzer.ts `typeMetaMapMembers()` 1583-1598：只扫
  // `declare module '@deepseek-ai/dsh-typert-protocol'` 内的 interface 成员。
  // 普通 interface 里的同名表不参与 lookup 判定，`agent: Agent` 应按 JSON 参数。
  it("协议模块之外的普通 TypertLookupMap 不参与 lookup 判定", async () => {
    const { host } = await generate({
      plainLookups: "    agent: TypertLookup<Agent, SessionId>",
      methods: "  /** Read. */\n  @Remote\n  read(agent: Agent): string { return agent.id }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("wire: 'agent',");
    expect(read).toContain("source: 'json',");
    expect(read).not.toContain("lookup: 'agent',");
  });

  // 同上：普通 interface 的 TypertContextMap 不满足 `@RemoteScope` 的静态 Context 声明。
  // 上游 remote-model.spec.ts 974-979 的同类判据。
  it("协议模块之外的普通 TypertContextMap 不满足 @RemoteScope", async () => {
    await expect(
      generate({
        plainContexts: "    agent: TypertContext<SessionId>",
        methods:
          "  /** Rename. */\n  @RemoteScope('agent')\n  rename(title: string): string { return title }",
      }),
    ).rejects.toThrow(/has no TypertContextMap entry|没有 TypertContextMap 条目/u);
  });

  // analyzer.ts 1524 只要求是 property signature；可选属性签名的 `type` 仍在，上游不会拒绝
  // （`required properties` 针对的是方法/索引签名）。这里锁住"可选属性仍生效"。
  it("可选的 lookup 表成员仍是合法条目", async () => {
    const { host } = await generate({
      lookups: "    agent?: TypertLookup<Agent, SessionId>",
      methods: "  /** Read. */\n  @Remote\n  read(agent: Agent): string { return agent.id }",
    });
    expect(descriptorOf(host, "@x/demo#demo/read")).toContain("lookup: 'agent',");
  });
});

describe("lookup 参数判据", () => {
  // analyzer.ts 1176-1195：按参数类型的宿主符号命中 lookup；wire 是 `${key}Id`。
  // remote-model.spec.ts 309-333 锁同一形态。
  it("宿主对象类型命中 lookup：wire 为 `${key}Id`、source 为 lookup、codec 用 wire id 类型", async () => {
    const { host } = await generate({
      lookups: AGENT_LOOKUP,
      contexts: AGENT_CONTEXT,
      methods: "  /** Read. */\n  @Remote\n  read(agent: Agent): string { return agent.id }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("name: 'agent',");
    expect(read).toContain("wire: 'agentId',");
    expect(read).toContain("source: 'lookup',");
    expect(read).toContain("lookup: 'agent',");
    // analyzer.ts 1184-1188：boundary 用 lookup 的 wire 类型，不是宿主对象类型。
    expect(read).toContain("typeSymbol: '@x/demo#SessionId'");
    expect(read).not.toContain("typeSymbol: '@x/demo#Agent'");
  });

  // analyzer.ts 1150-1177：命中依据是参数的**宿主对象类型**，不是 wire id 类型。
  // 现场回归：`SessionId` 同时是两个 lookup 的 wire 类型，不能因此把 `sessionId` 当上下文参数。
  it("只按 wire id 类型相同不能判成 lookup：`sessionId: SessionId` 走 JSON", async () => {
    const { host } = await generate({
      lookups: `${AGENT_LOOKUP}\n${SCOPE_LOOKUP}`,
      contexts: `${AGENT_CONTEXT}\n    workspaceFileScope: TypertContext<SessionId>`,
      methods: "  /** List. */\n  @Remote\n  list(sessionId: SessionId): SessionId[] { return [] }",
    });
    const list = descriptorOf(host, "@x/demo#demo/list");
    expect(list).toContain("name: 'sessionId',");
    expect(list).toContain("wire: 'sessionId',");
    expect(list).toContain("source: 'json',");
    expect(list).not.toContain("lookup:");
    expect(list).not.toContain("scope:");
  });

  // analyzer.ts 1181-1183：lookup 参数名必须等于 key。
  it("lookup 参数名不等于 key → 生成失败", async () => {
    await expect(
      generate({
        lookups: AGENT_LOOKUP,
        methods: "  /** Read. */\n  @Remote\n  read(owner: Agent): string { return owner.id }",
      }),
    ).rejects.toThrow(/lookup parameter for agent must also be named agent|必须命名为 agent/u);
  });

  // analyzer.ts 1180：lookup 参数不能 optional。remote-model.spec.ts 909-912。
  it("lookup 参数可选 → 生成失败", async () => {
    await expect(
      generate({
        lookups: AGENT_LOOKUP,
        methods:
          "  /** Read. */\n  @Remote\n  read(agent?: Agent): string { return agent?.id ?? '' }",
      }),
    ).rejects.toThrow(/lookup parameter for agent cannot be optional|不能是可选参数/u);
  });

  // analyzer.ts 1214-1215：wire 字段唯一；lookup 的 `${key}Id` 与普通参数重名即冲突。
  it("lookup 的 wire 与 JSON 参数重名 → 生成失败", async () => {
    await expect(
      generate({
        lookups: AGENT_LOOKUP,
        methods:
          "  /** Read. */\n  @Remote\n  read(agent: Agent, agentId: SessionId): string { return agentId + agent.id }",
      }),
    ).rejects.toThrow(/duplicate Remote wire field agentId|重复的 Remote wire 字段 agentId/u);
  });

  // analyzer.ts 1196-1199：workspace class 参数没有 lookup 表条目 → 生成失败。
  // remote-model.spec.ts 938-946 锁同一判据。
  it("workspace class 参数没有 lookup 表条目 → 生成失败（不能当 JSON）", async () => {
    await expect(
      generate({
        upstreamTypes:
          "/** Host-only class. */\nexport class Unregistered { readonly id: SessionId = '' }",
        dtsTypes: "export declare class Unregistered { readonly id: SessionId; }",
        methods:
          "  /** Read. */\n  @Remote\n  read(unregistered: Unregistered): string { return unregistered.id }",
      }),
    ).rejects.toThrow(/non-JSON class parameter Unregistered requires a TypertLookupMap entry/u);
  });

  // analyzer.ts 1196-1199 的 `isWorkspaceClass` 只针对 class；接口没注册就是普通 JSON 结构。
  it("未注册的宿主 interface 参数按 JSON 传（不是 lookup）", async () => {
    const { host } = await generate({
      methods: "  /** Read. */\n  @Remote\n  read(agent: Agent): string { return agent.id }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("wire: 'agent',");
    expect(read).toContain("source: 'json',");
    expect(read).not.toContain("lookup:");
  });

  // analyzer.ts 1240-1247：direct 方法只要**恰好一个** lookup 参数就取它做 scope，
  // 与参数位置无关。
  it("唯一 lookup 参数在第二位仍设 scope", async () => {
    const { host } = await generate({
      lookups: AGENT_LOOKUP,
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Read. */\n  @Remote\n  read(payload: Payload, agent: Agent): string { return payload.title + agent.id }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("lookup: 'agent',");
    expect(read).toContain(
      "scope: {\n        context: 'agent',\n        wire: 'agentId',\n      },",
    );
  });
});

describe("direct 方法的 scope 推导", () => {
  // analyzer.ts 1240-1261：恰好一个 lookup + 同名 TypertContextMap 条目 → scope。
  it("一个 lookup 且同名 context → 方法 scope 取它", async () => {
    const { host } = await generate({
      lookups: AGENT_LOOKUP,
      contexts: AGENT_CONTEXT,
      methods: "  /** Read. */\n  @Remote\n  read(agent: Agent): string { return agent.id }",
    });
    expect(descriptorOf(host, "@x/demo#demo/read")).toContain(
      "scope: {\n        context: 'agent',\n        wire: 'agentId',\n      },",
    );
  });

  // analyzer.ts 1242：`lookupParameters.length === 1`；多个 lookup 参数没有方法 scope。
  it("两个 lookup 参数 → 都按 lookup 传，但没有方法 scope", async () => {
    const { host } = await generate({
      lookups: `${AGENT_LOOKUP}\n${SCOPE_LOOKUP}`,
      contexts: `${AGENT_CONTEXT}\n    workspaceFileScope: TypertContext<SessionId>`,
      methods:
        "  /** Read. */\n  @Remote\n  read(agent: Agent, workspaceFileScope: WorkspaceFileScope): string { return agent.id + workspaceFileScope.workspaceRoot }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("lookup: 'agent',");
    expect(read).toContain("lookup: 'workspaceFileScope',");
    expect(read).not.toContain("scope:");
  });

  // 同上：即使其中一个 lookup 有同名 context，lookup 数量不是 1 也不设 scope。
  it("两个 lookup 且其中一个有同名 context → 仍没有方法 scope", async () => {
    const { host } = await generate({
      lookups: `${AGENT_LOOKUP}\n${SCOPE_LOOKUP}`,
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Read. */\n  @Remote\n  read(agent: Agent, workspaceFileScope: WorkspaceFileScope): string { return agent.id + workspaceFileScope.workspaceRoot }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("lookup: 'agent',");
    expect(read).not.toContain("scope:");
  });

  // analyzer.ts 1244-1247：lookup 在 context 表缺席 → 参数仍是 lookup，但没有 scope。
  it("lookup 没有同名 context 条目 → 没有方法 scope", async () => {
    const { host } = await generate({
      lookups: SCOPE_LOOKUP,
      methods:
        "  /** Read. */\n  @Remote\n  read(workspaceFileScope: WorkspaceFileScope): string { return workspaceFileScope.workspaceRoot }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("lookup: 'workspaceFileScope',");
    expect(read).not.toContain("scope:");
  });

  // analyzer.ts 1248-1258：context 与 lookup 的 wire 类型必须是同一个符号。
  it("context 与 lookup 的 wire 类型不一致 → 生成失败", async () => {
    await expect(
      generate({
        upstreamTypes: "export type OtherAgentId = string",
        dtsTypes: "export type OtherAgentId = string;",
        lookups: "    agent: TypertLookup<Agent, OtherAgentId>",
        contexts: AGENT_CONTEXT,
        methods: "  /** Read. */\n  @Remote\n  read(agent: Agent): string { return agent.id }",
      }),
    ).rejects.toThrow(/does not match lookup wire type|与 lookup wire 类型 .* 不一致/u);
  });
});

describe("@RemoteScope", () => {
  // analyzer.ts 1220-1238：`@RemoteScope` 生成 Context receiver；
  // `model.ts` 136-143 的 invocation 是 `{ kind: 'context', context, wire }`，
  // receiver 独立于业务 parameters（不占一个 lookup 参数）。
  // remote-model.spec.ts 334-352、remote-metadata.spec.ts 202-215 锁同一形态。
  it("有 context 条目 → descriptor 是 context 接收者，wire 为 `${key}Id`，参数表不含接收者", async () => {
    const { host } = await generate({
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Rename. */\n  @RemoteScope('agent')\n  rename(title: string): string { return title }",
    });
    const rename = descriptorOf(host, "@x/demo#demo/rename");
    expect(rename).toContain("invocation: { kind: 'context', context: 'agent', wire: 'agentId' },");
    expect(rename).not.toContain("scope: {");
    expect(rename).not.toContain("lookup: 'agent',");
    expect(rename).toContain("name: 'title',");
  });

  // analyzer.ts 1414-1432：`@RemoteScope` 的 key 必须只含 RPC endpoint segment 字符。
  it("@RemoteScope 的 key 含非法字符 → 生成失败（key 格式判据）", async () => {
    await expect(
      generate({
        contexts: AGENT_CONTEXT,
        methods:
          "  /** Rename. */\n  @RemoteScope('agent x')\n  rename(title: string): string { return title }",
      }),
    ).rejects.toThrow(
      /RemoteScope\(\) key must be a string literal containing only RPC endpoint segment characters|RPC endpoint segment/u,
    );
  });

  // analyzer.ts 1416-1418：`@RemoteScope()` 至少要一个参数。
  it("@RemoteScope 缺少 key → 生成失败", async () => {
    await expect(
      generate({
        methods:
          "  /** Rename. */\n  @RemoteScope()\n  rename(title: string): string { return title }",
      }),
    ).rejects.toThrow(/RemoteScope\(\) requires a Context key/u);
  });

  // analyzer.ts 1436：一个方法只能有一个 Remote 调用装饰器。
  it("同一个方法同时有 @Remote 与 @RemoteScope → 生成失败", async () => {
    await expect(
      generate({
        contexts: AGENT_CONTEXT,
        methods:
          "  /** Rename. */\n  @Remote\n  @RemoteScope('agent')\n  rename(title: string): string { return title }",
      }),
    ).rejects.toThrow(/a method can have only one Remote invocation decorator/u);
  });

  // analyzer.ts 1423-1429：第二个字符串参数是导出的方法名。
  it("@RemoteScope 的第二个参数是导出方法名", async () => {
    const { host } = await generate({
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Rename. */\n  @RemoteScope('agent', 'renameGoal')\n  rename(title: string): string { return title }",
    });
    expect(descriptorOf(host, "@x/demo#demo/renameGoal")).toContain("implementation: 'rename'");
  });

  // analyzer.ts 1222-1225：只有 lookup 条目不够，必须有 TypertContextMap 条目。
  it("@RemoteScope 只有同名 lookup、没有 context 条目 → 生成失败", async () => {
    await expect(
      generate({
        lookups: AGENT_LOOKUP,
        methods:
          "  /** Rename. */\n  @RemoteScope('agent')\n  rename(title: string): string { return title }",
      }),
    ).rejects.toThrow(/has no TypertContextMap entry|没有 TypertContextMap 条目/u);
  });

  // analyzer.ts 1226-1227：receiver 的 `${key}Id` 与业务参数 wire 冲突 → 生成失败。
  it("@RemoteScope 的 wire 与业务参数重名 → 生成失败", async () => {
    await expect(
      generate({
        contexts: AGENT_CONTEXT,
        methods:
          "  /** Rename. */\n  @RemoteScope('agent')\n  rename(agentId: SessionId): string { return agentId }",
      }),
    ).rejects.toThrow(/duplicate Remote wire field agentId|重复的 Remote wire 字段 agentId/u);
  });

  // analyzer.ts 1228-1237：receiver 自动补在 wire 上，但实现签名里不写；
  // remote-model.spec.ts 376-384 / remote-metadata.spec.ts 207-214：
  // Context-only 方法不进 direct 方法表，只进 ScopeMap。
  it("remote-client 不把 Context-only 方法放进 direct 方法表，只放进 ScopeMap", async () => {
    const { remote } = await generate({
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Rename. */\n  @RemoteScope('agent')\n  rename(title: string): string { return title }",
    });
    expect(remote).toContain(
      "'agent:demo/rename': (title: string) => Promise<RemoteResult<string>>",
    );
    expect(remote).not.toContain("'demo/rename':");
    expect(remote).not.toContain("    rename: (");
  });

  // 同上：客户端 ScopeMap 签名里不重复上下文参数。
  it("ScopeMap 的签名省略自动补的上下文参数", async () => {
    const { remote } = await generate({
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Rename. */\n  @RemoteScope('agent')\n  rename(title: string): string { return title }",
    });
    expect(remote).toContain(
      "'agent:demo/rename': (title: string) => Promise<RemoteResult<string>>",
    );
    expect(remote).not.toContain("'agent:demo/rename': (agentId");
  });

  // analyzer.ts 1240-1261 + 1220：direct + scope 方法仍有两个签名面：
  // direct 方法表里带 `agentId`，ScopeMap 里省略。remote-model.spec.ts 370-384。
  it("direct + scope 方法在 direct 方法表里带 agentId，在 ScopeMap 里省略", async () => {
    const { remote } = await generate({
      lookups: AGENT_LOOKUP,
      contexts: AGENT_CONTEXT,
      methods:
        "  /** Read. */\n  @Remote\n  read(agent: Agent, payload: Payload, signal?: AbortSignal): string { return payload.title + agent.id }",
    });
    expect(remote).toContain(
      "'demo/read': (agentId: SessionId, payload: Payload, signal?: AbortSignal) => Promise<RemoteResult<string>>",
    );
    expect(remote).toContain(
      "'agent:demo/read': (payload: Payload, signal?: AbortSignal) => Promise<RemoteResult<string>>",
    );
  });
});

describe("普通 JSON 参数与取消通道", () => {
  // analyzer.ts 1200-1212：普通 JSON 参数的 wire 名等于参数名。
  it("普通 JSON 参数的 wire 名等于参数名", async () => {
    const { host } = await generate({
      methods:
        "  /** Read. */\n  @Remote\n  read(payload: Payload): string { return payload.title }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("name: 'payload',");
    expect(read).toContain("wire: 'payload',");
    expect(read).toContain("source: 'json',");
  });

  // analyzer.ts 1200-1212：optional 参数带 `optional: true`，wire 上接受 undefined。
  it("可选 JSON 参数在 wire 上接受 undefined", async () => {
    const { host } = await generate({
      methods:
        "  /** Read. */\n  @Remote\n  read(payload: Payload, options?: Options): string { return payload.title + String(options?.deep) }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("name: 'options',");
    expect(read).toContain("wire: 'options',");
    expect(read).toContain("acceptsUndefined: true,");
  });

  // analyzer.ts 1164-1175：`signal: AbortSignal` 是取消通道，不进 wire 参数表。
  // remote-model.spec.ts 331、391。
  it("末尾的 signal: AbortSignal 记为 cancellation，不进参数表", async () => {
    const { host } = await generate({
      methods:
        "  /** Read. */\n  @Remote\n  read(payload: Payload, signal: AbortSignal): string { signal.throwIfAborted(); return payload.title }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("cancellation: { parameter: 'signal' },");
    expect(read).not.toContain("name: 'signal',");
  });

  // 同上：可选写法的 signal 仍是取消通道。
  it("可选 signal?: AbortSignal 仍是取消通道", async () => {
    const { host } = await generate({
      methods:
        "  /** Read. */\n  @Remote\n  read(payload: Payload, signal?: AbortSignal): string { signal?.throwIfAborted(); return payload.title }",
    });
    const read = descriptorOf(host, "@x/demo#demo/read");
    expect(read).toContain("cancellation: { parameter: 'signal' },");
    expect(read).not.toContain("name: 'signal',");
  });

  // analyzer.ts 1170-1172：取消通道必须是最后一个参数。remote-model.spec.ts 923-930。
  it("signal 不是最后一个参数 → 生成失败", async () => {
    await expect(
      generate({
        methods:
          "  /** Read. */\n  @Remote\n  read(payload: Payload, signal: AbortSignal, options: Options): string { signal.throwIfAborted(); return payload.title }",
      }),
    ).rejects.toThrow(/Remote cancellation signal must be the final parameter/u);
  });

  // analyzer.ts 1164-1169：名字是 signal 但类型不是全局 AbortSignal → 生成失败。
  // remote-model.spec.ts 913-916。
  it("名字是 signal 但类型不是 AbortSignal → 生成失败", async () => {
    await expect(
      generate({
        methods:
          "  /** Read. */\n  @Remote\n  read(payload: Payload, signal: string): string { return payload.title + signal }",
      }),
    ).rejects.toThrow(
      /Remote cancellation must use a parameter named signal with the global AbortSignal type/u,
    );
  });

  // analyzer.ts 1164-1169：类型是 AbortSignal 但名字不是 signal → 生成失败。
  // remote-model.spec.ts 918-921。
  it("类型是 AbortSignal 但名字不是 signal → 生成失败", async () => {
    await expect(
      generate({
        methods:
          "  /** Read. */\n  @Remote\n  read(payload: Payload, abort: AbortSignal): string { abort.throwIfAborted(); return payload.title }",
      }),
    ).rejects.toThrow(
      /Remote cancellation must use a parameter named signal with the global AbortSignal type/u,
    );
  });
});
