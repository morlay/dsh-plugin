// 两段运行时策略文本的渲染：三种 mode 的中文语义、规则追加、审批两段按有效策略选。
//
// 纯函数，不起装配——接管时机（第一次装配就是中文）由 `runtime-contexts.spec.ts` 守。
import {
  renderApprovalContext,
  renderPolicyContext,
  APPROVAL_POLICY_CONTEXT,
  SANDBOX_POLICY_CONTEXT,
} from "@morlay/configurable-sandbox";
import { describe, expect, it } from "vitest";

const WORKSPACE = "/work";

describe("sandbox:policy 文本", () => {
  it("三种 mode 各自的中文语义", () => {
    expect(
      renderPolicyContext({ mode: "read-only", workspaceRoot: WORKSPACE }, emptyRules()),
    ).toContain("只读");
    expect(
      renderPolicyContext({ mode: "workspace-write", workspaceRoot: WORKSPACE }, emptyRules()),
    ).toContain(JSON.stringify(WORKSPACE));
    expect(
      renderPolicyContext({ mode: "danger-full-access", workspaceRoot: WORKSPACE }, emptyRules()),
    ).toContain("全权");
  });

  it("空的规则不加尾巴（与官方那段同语义）", () => {
    const text = renderPolicyContext(
      { mode: "workspace-write", workspaceRoot: WORKSPACE },
      emptyRules(),
    );

    expect(text).not.toContain("额外可写");
    expect(text).not.toContain("只读（不可写）");
    expect(text).not.toContain("拒绝（读写都拒）");
  });

  it("三类条目各追加一句，按 rw / r- / -- 的顺序", () => {
    const text = renderPolicyContext(
      { mode: "workspace-write", workspaceRoot: WORKSPACE },
      {
        allowWrite: ["/cache"],
        readOnly: ["/ro"],
        deny: ["**/*.pem"],
      },
    );

    const writable = text.indexOf("额外可写");
    const readOnly = text.indexOf("只读（不可写）");
    const denied = text.indexOf("拒绝（读写都拒）");
    expect(writable).toBeGreaterThan(-1);
    expect(readOnly).toBeGreaterThan(writable);
    expect(denied).toBeGreaterThan(readOnly);
  });

  it("两条上下文名与上游同名（同名才叫接管）", () => {
    expect(SANDBOX_POLICY_CONTEXT).toBe("sandbox:policy");
    expect(APPROVAL_POLICY_CONTEXT).toBe("approval:policy");
  });
});

describe("approval:policy 文本", () => {
  it("ask 与 never 是两段不同的话", () => {
    const ask = renderApprovalContext("ask");
    const never = renderApprovalContext("never");

    expect(ask).toContain("ask");
    expect(never).toContain("审批提示已禁用");
    expect(never).toContain("不要请求沙箱升级");
    expect(ask).not.toBe(never);
  });
});

function emptyRules() {
  return { allowWrite: [], readOnly: [], deny: [] };
}
