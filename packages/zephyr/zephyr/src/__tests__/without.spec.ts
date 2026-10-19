import { describe, expect, it } from "vitest";
import { Module, providersOfModule, without } from "@morlay/zephyr";
import { Injectable } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Service } from "@deepseek-ai/cordis";

class Upstream extends Service {
  constructor(ctx: never) {
    super(ctx, "upstream");
  }
}

@Injectable()
class Row extends fromCordis(Upstream, Upstream) {}

@Module({ providers: [Row.withConfig({})] })
class Inner {}

@Module({ imports: [Inner] })
class Middle {}

@Module({ imports: [Middle], providers: [without(Row)] })
class Outer {}

describe("without 的运行时剔除", () => {
  it("跨层 imports 也能剔除 withConfig 生成的条目", () => {
    expect(providersOfModule(Outer)).toHaveLength(0);
  });

  it("目标模块本身仍能独立展开", () => {
    expect(providersOfModule(Middle)).toHaveLength(1);
  });
});
