// 端点认领差集的判据（`remote-claims.ts`）：解析、闭包、差集三个方向都要有判据。
//
// **反向那条是本文件存在的理由**：装配清单里缺一个 `provideXxx()`，或它被 `without(…)` 剔掉，
// 差集必须把那个组报出来——否则这条规则对「浏览器 404」没有任何价值。
import { describe, expect, test } from "vitest";
import {
  assemblyFactsOf,
  installedOf,
  missingClaimsOf,
  remoteFactsOf,
  routeGroupOf,
  type ProvideList,
  type RemoteClaim,
  type RemoteDemand,
} from "../remote-claims.ts";

const CONTRACT = [
  "@Injectable({ name: \"settings\" })",
  "@RemoteGroup({ name: \"settings\" })",
  "export abstract class SettingsEndpoint {}",
].join("\n");

const HOST_ROW = [
  "@RemoteGroup()",
  "@Injectable()",
  "export class SettingEndpointDefault extends SettingsEndpoint implements OnInit {",
  "  private readonly handlers = inject(RemoteHandlers);",
  "  onInit(): void { registerRemoteGroup(this.handlers, this); }",
  "}",
  "export const provideSetting = provide([SettingLoader, SettingEndpointDefault]);",
].join("\n");

const ROUTE_ROW = [
  "@Injectable()",
  "export class OpenInAppHostRow extends fromCordis(OpenInAppHost, Plugin) {",
  "  onInit(): void {",
  "    this.webServer.register({ kind: \"exact\", path: \"/open-in-app/apps\", handler });",
  "    this.connection.fetch.register({ path: \"/api/present.host\" });",
  "  }",
  "}",
  "export const provideOpenInApp = provide([OpenInAppHostRow]);",
].join("\n");

describe("routeGroupOf", () => {
  test("`/api/<名>` 取第二段，其余取首段", () => {
    expect(routeGroupOf("/api/present.host")).toBe("present.host");
    expect(routeGroupOf("/open-in-app/apps")).toBe("open-in-app");
    expect(routeGroupOf("/")).toBe("");
  });
});

describe("remoteFactsOf", () => {
  test("`@RemoteGroup()` 无名的行沿**跨文件**契约类解析组名", async () => {
    const shared = new Map<string, { group: string; base: string }>();
    const contract = await remoteFactsOf("pkg/src/endpoint/settings.group.ts", CONTRACT, shared);
    const host = await remoteFactsOf("pkg/src/server/setting-endpoint.service.ts", HOST_ROW, shared);
    expect(contract.demands.map((demand) => demand.group)).toEqual(["settings"]);
    expect(host.claims).toEqual([
      { kind: "handler", group: "settings", row: "class:SettingEndpointDefault", file: "pkg/src/server/setting-endpoint.service.ts" },
    ]);
    expect(host.unknown).toEqual([]);
  });

  test("HTTP 路由行按路径前缀给出组名（两类载体都算）", async () => {
    const facts = await remoteFactsOf("pkg/src/server/open-in-app.service.ts", ROUTE_ROW);
    expect(facts.claims.map((claim) => [claim.kind, claim.group, claim.row])).toEqual([
      ["route", "open-in-app", "class:OpenInAppHostRow"],
      ["route", "present.host", "class:OpenInAppHostRow"],
    ]);
  });

  test("`provide([...])` 的清单与 `remoteDescriptor` 行都被记下来", async () => {
    const source = [
      "export const provideX = provide([",
      "  SomeRow,",
      "  remoteDescriptor(() => import(\"@deepseek-ai/dsh-x/remote\")),",
      "]);",
    ].join("\n");
    const facts = await remoteFactsOf("pkg/src/server/x.provide.ts", source);
    expect(facts.lists).toEqual([
      { provide: "provideX", rows: ["class:SomeRow", "spec:@deepseek-ai/dsh-x/remote"] },
    ]);
    expect(facts.claims).toEqual([
      {
        kind: "descriptor",
        group: "",
        row: "spec:@deepseek-ai/dsh-x/remote",
        file: "pkg/src/server/x.provide.ts",
      },
    ]);
  });
});

describe("装配清单 → 装上的行", () => {
  const lists: readonly ProvideList[] = [
    { provide: "provideSetting", rows: ["class:SettingEndpointDefault"] },
    { provide: "provideOpenInApp", rows: ["class:OpenInAppHostRow"] },
  ];
  const claims: readonly RemoteClaim[] = [
    { kind: "handler", group: "settings", row: "class:SettingEndpointDefault", file: "a" },
    { kind: "route", group: "open-in-app", row: "class:OpenInAppHostRow", file: "b" },
  ];
  const demands: readonly RemoteDemand[] = [
    { group: "settings", file: "endpoint/settings.group.ts" },
    { group: "open-in-app", file: "ui/open-in-app.client.ts" },
  ];
  const groupsOf = (): readonly string[] => [];

  test("清单点名了两份 provide：两个组都算装上", async () => {
    const assembly = await assemblyFactsOf(
      [
        "function deploymentProviders() { return [...provideSetting(), ...provideOpenInApp()]; }",
        "return [...deploymentProviders()];",
      ].join("\n"),
    );
    const installed = installedOf({
      calls: assembly.calls,
      edges: assembly.edges,
      lists,
      removals: [],
      withouts: assembly.withouts,
    });
    expect([...installed.rows].sort()).toEqual(["class:OpenInAppHostRow", "class:SettingEndpointDefault"]);
    expect(
      missingClaimsOf({ demands, claims, installedRows: installed.rows, upstreamGroupsOf: groupsOf, exempt: new Set() })
        .missing,
    ).toEqual([]);
  });

  test("**清单缺 `provideSetting()` → 差集报 `settings`**（这条是规则的唯一价值证明）", async () => {
    const assembly = await assemblyFactsOf(
      [
        "function deploymentProviders() { return [...provideOpenInApp()]; }",
        "return [...deploymentProviders()];",
      ].join("\n"),
    );
    const installed = installedOf({
      calls: assembly.calls,
      edges: assembly.edges,
      lists,
      removals: [],
      withouts: assembly.withouts,
    });
    const { missing } = missingClaimsOf({
      demands,
      claims,
      installedRows: installed.rows,
      upstreamGroupsOf: groupsOf,
      exempt: new Set(),
    });
    expect(missing).toEqual([
      { group: "settings", demands: ["endpoint/settings.group.ts"], claimedSomewhere: true },
    ]);
  });

  test("`without(SettingEndpointDefault)` 剔掉的行不算装上，差集要说是「有行但没装」", async () => {
    const assembly = await assemblyFactsOf(
      [
        "function deploymentProviders() { return [...provideSetting(without(SettingEndpointDefault)), ...provideOpenInApp()]; }",
        "return [...deploymentProviders()];",
      ].join("\n"),
    );
    const installed = installedOf({
      calls: assembly.calls,
      edges: assembly.edges,
      lists,
      removals: [],
      withouts: assembly.withouts,
    });
    const { missing } = missingClaimsOf({ demands, claims, installedRows: installed.rows, upstreamGroupsOf: groupsOf, exempt: new Set() });
    expect(missing.map((item) => [item.group, item.claimedSomewhere])).toEqual([["settings", true]]);
  });

  test("豁免清单里的组不报（理由写在 `rules.ts`）", async () => {
    const { missing } = missingClaimsOf({
      demands: [{ group: "$events", file: "x" }],
      claims: [],
      installedRows: new Set(),
      upstreamGroupsOf: groupsOf,
      exempt: new Set(["$events"]),
    });
    expect(missing).toEqual([]);
  });
});