// `{DSH_HOME}/sandbox.toml` 的读取：合法文件 / 文件缺失 / 坏文件 / 字段不认识。
//
// 判据是「坏配置不阻断启动」：四种坏法一个口径——整份配置按"没有规则"处理，宿主照常起来。
import { describe, expect, it } from "vitest";
import { loadRules } from "./support/fake-sandbox-file.ts";

describe("sandbox.toml", () => {
  it("合法文件：六个字段都读到，规则源按前缀分桶", async () => {
    const { rules, dispose } = await loadRules(
      [
        "access = [\"rw /cache\", 'r- /ro', '-- **/*.pem']",
        'runnerCommand = ["/usr/bin/bwrap"]',
        'runnerFailureSignatures = ["bwrap: "]',
        "probeTimeoutMs = 1234",
        'cwd = "/work"',
        "diffBasisMaxBytes = 2048",
      ].join("\n"),
    );
    try {
      expect(rules.settings()).toMatchObject({
        runnerCommand: ["/usr/bin/bwrap"],
        runnerFailureSignatures: ["bwrap: "],
        probeTimeoutMs: 1234,
        cwd: "/work",
        diffBasisMaxBytes: 2048,
      });
      expect(rules.source()).toEqual({
        allowWrite: ["/cache"],
        readOnly: ["/ro"],
        deny: ["**/*.pem"],
      });
    } finally {
      await dispose();
    }
  });

  it("文件缺失：全用默认值，规则为空（不阻断启动）", async () => {
    const { rules, dispose } = await loadRules(undefined);
    try {
      expect(rules.settings()).toMatchObject({
        access: [],
        runnerCommand: [],
        runnerFailureSignatures: [],
        probeTimeoutMs: 5_000,
        diffBasisMaxBytes: 10 * 1024 * 1024,
      });
      expect(rules.source()).toEqual({ allowWrite: [], readOnly: [], deny: [] });
    } finally {
      await dispose();
    }
  });

  it("坏文件（不是 TOML）：退到没有规则，仍起得来", async () => {
    const { rules, dispose } = await loadRules("access = [");
    try {
      expect(rules.source()).toEqual({ allowWrite: [], readOnly: [], deny: [] });
      expect(rules.settings().probeTimeoutMs).toBe(5_000);
    } finally {
      await dispose();
    }
  });

  it("字段不认识：整份退到没有规则（挑一半字段生效比一条都不生效更难查）", async () => {
    const { rules, dispose } = await loadRules(
      ['access = ["-- *.pem"]', 'unknownField = "ignored"', "diffBasisMaxBytes = 4096"].join("\n"),
    );
    try {
      expect(rules.source()).toEqual({ allowWrite: [], readOnly: [], deny: [] });
      expect(rules.settings().diffBasisMaxBytes).toBe(10 * 1024 * 1024);
    } finally {
      await dispose();
    }
  });

  it("字段类型不对：退到没有规则（半套配置比没有更危险）", async () => {
    const { rules, dispose } = await loadRules(
      ['access = ["-- *.pem"]', 'probeTimeoutMs = "not a number"'].join("\n"),
    );
    try {
      expect(rules.source()).toEqual({ allowWrite: [], readOnly: [], deny: [] });
    } finally {
      await dispose();
    }
  });

  it("条目语法不对：同样退到没有规则", async () => {
    const { rules, dispose } = await loadRules('access = ["x /cache"]');
    try {
      expect(rules.source()).toEqual({ allowWrite: [], readOnly: [], deny: [] });
    } finally {
      await dispose();
    }
  });
});
