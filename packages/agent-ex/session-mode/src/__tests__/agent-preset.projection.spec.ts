// `agentPreset` 投影的两条判据：主会话按部署那一份兜底，子代理**不兜底**。
//
// 子代理兜底会让上游冷恢复（`applyChildComposition`）以为它有一份已保存的 preset，去要
// `agentPresets` 服务；本部署不装 roster（只有 ptc），于是 `send_message` 给 idle 子代理直接失败。
import { describe, expect, test } from "@morlay/session-mode/testing";
import { agentPresetProjection } from "../session-mode.projection.ts";

const projection = agentPresetProjection("ptc");

describe("agentPreset 投影", () => {
  test("主会话没有 header 值时报部署那一个 id", () => {
    expect((projection.init as (header: object) => unknown)({})).toBe("ptc");
  });

  test("主会话 header 带了值就照它", () => {
    expect((projection.init as (header: object) => unknown)({ agentPreset: "minimal" })).toBe(
      "minimal",
    );
  });

  test("子代理不兜底：没有自己的 preset 就是 null（续跑不需要 roster）", () => {
    expect(
      (projection.init as (header: object) => unknown)({ parentSession: "parent-1" }),
    ).toBeNull();
  });

  test("子代理 header 显式带了 preset 时照它（冷恢复仍能挂载）", () => {
    expect(
      (projection.init as (header: object) => unknown)({
        parentSession: "parent-1",
        agentPreset: "ptc",
      }),
    ).toBe("ptc");
  });
});
