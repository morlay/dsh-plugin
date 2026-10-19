import { describe, expect, it } from "vitest";
import { orderRuntimes, type RowRuntime } from "../runtime.ts";
import { InjectionToken } from "@morlay/zephyr";

const tokenOf = (name: string) => new InjectionToken<unknown>(name);

const row = (name: string, token: ReturnType<typeof tokenOf>, dependencies: readonly { value: unknown }[]): RowRuntime =>
  ({
    name,
    token: token as never,
    dependencies: dependencies.map((item) => item.value as never),
    start: async () => {},
    dispose: async () => {},
  }) as unknown as RowRuntime;

describe("RowRuntime 的拓扑排序", () => {
  it("被依赖的先 start", () => {
    const a = tokenOf("a");
    const b = tokenOf("b");
    const consumer = row("consumer", tokenOf("consumer"), [{ value: b }]);
    const bRow = row("b", b, [{ value: a }]);
    const aRow = row("a", a, []);
    expect(orderRuntimes([consumer, bRow, aRow]).map((r) => r.name)).toEqual(["a", "b", "consumer"]);
  });

  it("别名也算提供者", () => {
    const contract = tokenOf("contract");
    const alias = tokenOf("alias");
    const provider = row("provider", contract, []);
    const consumer = row("consumer", tokenOf("consumer"), [{ value: alias }]);
    const providers = new Map<never, number>([
      [contract as never, 1],
      [alias as never, 1],
    ]);
    expect(orderRuntimes([consumer, provider], providers).map((r) => r.name)).toEqual([
      "provider",
      "consumer",
    ]);
  });

  it("环形依赖直接报错（带路径）", () => {
    const a = tokenOf("a");
    const b = tokenOf("b");
    const rowA = row("a", a, [{ value: b }]);
    const rowB = row("b", b, [{ value: a }]);
    expect(() => orderRuntimes([rowA, rowB])).toThrow(/circular dependency.*a -> b -> a/);
  });
});
