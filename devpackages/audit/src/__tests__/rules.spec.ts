// 类型纪律两条判据的自测：白名单语义与面判定的**唯一** home 是 `../rules.ts`，
// 这里按判据逐条断言——想放宽白名单，先改规则再改这里。
import { describe, expect, it } from "vitest";
import {
  baselineVerdict,
  bridgeReason,
  isAllowedContractValueEdge,
  isContractOrEndpointFace,
  isTestPath,
  isUpstreamPackageRoot,
  keepReason,
  TYPE_DISCIPLINE_BASELINE,
} from "../rules.ts";

describe("bridgeReason（双断言白名单）", () => {
  it("装配入口与 cordis 兼容桥命中，理由说得出另一头是什么", () => {
    expect(bridgeReason("packages/zephyr/zephyr/src/bootstrap.ts")).toContain("cordis Context");
    expect(bridgeReason("packages/zephyr/zephyr/src/compat/from-cordis.ts")).toContain(
      "cordis 兼容桥",
    );
  });

  it("rdb 行映射命中：行 / 读回 / 后端 / 迁移文件", () => {
    for (const file of [
      "packages/agent-ex/better-session/src/rdb/log/rows.ts",
      "packages/agent-ex/better-session/src/rdb/read-path.ts",
      "packages/agent-ex/better-session/src/rdb/backend-rdb.ts",
      "packages/agent-ex/better-session/src/rdb/storage-takeover/legacy-domain-migration.ts",
      "packages/agent-ex/better-session/src/rdb/log-import.ts",
    ]) {
      expect(bridgeReason(file), file).toContain("SQL 行");
    }
  });

  it("域内断言不在白名单：rdb/log/repair.ts 与业务服务都要报", () => {
    expect(bridgeReason("packages/agent-ex/better-session/src/rdb/log/repair.ts")).toBeUndefined();
    expect(
      bridgeReason("packages/agent-ex/session-mode/src/session-mode.service.ts"),
    ).toBeUndefined();
    expect(bridgeReason("packages/zephyr/zephyr/src/token.ts")).toBeUndefined();
  });

  it("同名不同包也认（只按 `src/` 之后那一段判）", () => {
    expect(bridgeReason("packages/agent/dsh-x/src/bootstrap.ts")).toContain("cordis Context");
    expect(bridgeReason("src/bootstrap.ts")).toContain("cordis Context");
  });
});

describe("面判定", () => {
  it("契约 / 端点面", () => {
    expect(isContractOrEndpointFace("packages/agent/dsh-x/src/contract/a.contract.ts")).toBe(true);
    expect(isContractOrEndpointFace("packages/agent/dsh-x/src/endpoint/b.ts")).toBe(true);
    expect(isContractOrEndpointFace("packages/agent/dsh-x/src/ui/c.ts")).toBe(false);
    expect(isContractOrEndpointFace("packages/agent/dsh-x/src/server/d.ts")).toBe(false);
    expect(isContractOrEndpointFace("packages/agent/dsh-x/src/contracts/e.ts")).toBe(false);
  });

  it("Windows 风格路径同样命中", () => {
    expect(isContractOrEndpointFace("packages\\agent\\dsh-x\\src\\contract\\a.ts")).toBe(true);
  });

  it("测试判定只认 __tests__ 目录（`src/testing/**` 是生产面）", () => {
    expect(isTestPath("packages/agent/dsh-x/src/__tests__/a.spec.ts")).toBe(true);
    expect(isTestPath("packages/agent/dsh-session/src/testing/log.ts")).toBe(false);
  });
});

describe("契约面的值边判定", () => {
  it("只认上游包根：子路径与其它 scope 不算", () => {
    expect(isUpstreamPackageRoot("@deepseek-ai/dsh-llm")).toBe(true);
    expect(isUpstreamPackageRoot("@deepseek-ai/dsh-llm/types")).toBe(false);
    expect(isUpstreamPackageRoot("@morlay/zephyr")).toBe(false);
  });

  it("白名单当前为空：任何上游包根值边都不放行（先出报告）", () => {
    expect(isAllowedContractValueEdge("@deepseek-ai/dsh-llm")).toBe(false);
    expect(isAllowedContractValueEdge("@deepseek-ai/dsh-brand")).toBe(false);
  });
});

describe("keepReason 冒烟（别让规则文件的两段互相踩）", () => {
  const base = {
    self: "@morlay/x",
    used: new Set<string>(),
    scripts: "",
    manifest: "",
    siblings: new Set<string>(),
  };

  it("源码里 import 了的保留", () => {
    expect(keepReason({ ...base, name: "@local/y", used: new Set(["@local/y"]) })).toBeDefined();
  });

  it("什么都没用到就能删", () => {
    expect(keepReason({ ...base, name: "@local/z" })).toBeUndefined();
  });
});

describe("基线（只挡增量）", () => {
  it("当前数超出基线 → regressed（判据红）", () => {
    expect(baselineVerdict(173, 172)).toBe("regressed");
    expect(baselineVerdict(57, 56)).toBe("regressed");
  });

  it("等于基线 → ok", () => {
    expect(baselineVerdict(172, 172)).toBe("ok");
  });

  it("低于基线 → improvable（可以下调基线）", () => {
    expect(baselineVerdict(171, 172)).toBe("improvable");
    expect(baselineVerdict(0, 56)).toBe("improvable");
  });

  it("基线常量覆盖两条判据，且都是正数（0 就该删基线了）", () => {
    expect(TYPE_DISCIPLINE_BASELINE["contract-value-edge"]).toBeGreaterThan(0);
    expect(TYPE_DISCIPLINE_BASELINE["double-assertion"]).toBeGreaterThan(0);
  });
});
