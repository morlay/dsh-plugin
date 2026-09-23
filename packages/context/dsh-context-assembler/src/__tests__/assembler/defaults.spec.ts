// 默认抑制列表要覆盖上游 harness 自带的那几条 section——它们的名字写在上游源码里，
// 所以这里从那份源码取名字再比对：上游改名/新增开场白时这条会红（而不是悄悄漏进提示词）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_KEEP, DEFAULT_SUPPRESS } from "../../assembler/defaults.ts";

const UPSTREAM_SYSTEM_PROMPT = join(
  process.cwd(),
  "vendor/deepseek-harness/packages/core/system-prompt/src/index.ts",
);

describe("默认的 keep / suppress", () => {
  it("harness 开场白被抑制（身份由各模式的 persona 给）", async () => {
    const source = await readFile(UPSTREAM_SYSTEM_PROMPT, "utf8");
    const identity = /name: '(harness:[a-z-]+)'/u.exec(
      source.slice(source.indexOf("includeHarnessIdentity")),
    )?.[1];

    expect(identity, "上游 system-prompt 里找不到 harness 开场白的 section 名").toBeTruthy();
    expect(DEFAULT_SUPPRESS).toContain(identity);
  });

  it("平台运维说明与不装配的工具说明也在抑制列表里", () => {
    for (const name of [
      "harness:source",
      "app:web-surface",
      "tool:lsp",
      "tool:pty",
      "tool:session-query",
      "tool:cordis",
      "tool:ralph",
    ]) {
      expect(DEFAULT_SUPPRESS, name).toContain(name);
    }
  });

  it("persona 与规则声明留在提示词里", () => {
    expect(DEFAULT_KEEP.length).toBeGreaterThanOrEqual(3);
    // 三者都是上游 system-prompt 定义的 section 名（persona 前缀 / 后缀 + 我们的覆盖规则声明）。
    for (const name of DEFAULT_KEEP) expect(name.length).toBeGreaterThan(0);
  });
});
