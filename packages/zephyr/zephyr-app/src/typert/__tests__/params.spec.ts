/**
 * `DropParam` / `MapParam` / `AsyncReturn` 的判据：用**内联假类型**测（不借任何业务类型）。
 * 判据是 `AssertTrue<Equal<…>>`——编译期就红；运行期那行 `expect` 只是让用例在报告里有名字。
 *
 * 四条坑各一条：去掉末尾一个 / 换一个 / 可选与 rest 形参**原样保留**（工具不猜）/ 非方法成员不参与。
 */
import { describe, expect, test } from "@morlay/zephyr/testing";
import type { AsyncReturn, DropParam, MapParam } from "../params.ts";

/** 结构相等（含可选位与顺序）。 */
type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;

/** 编译期判据：为 `true` 才通过。 */
type AssertTrue<T extends true> = T;

interface Marker {
  readonly kind: "marker";
}

interface MarkerId {
  readonly kind: "marker-id";
}

/** 全必填 + signal 在末尾：正是上游 `@Remote` 方法的形状（`execute(agent, line, attachments, signal)`）。 */
interface RequiredFace {
  run(task: string, signal: AbortSignal): Promise<void>;
  sync(): string;
  lookup(target: Marker, note: string): Marker;
  readonly field: string;
}

describe("宿主面 → wire 面的投影", () => {
  test("去掉末尾的 AbortSignal：其余形参与返回类型原样", () => {
    type Wire = DropParam<RequiredFace, AbortSignal>;
    type Check = AssertTrue<Equal<Wire["run"], (task: string) => Promise<void>>>;
    const check: Check = true;
    expect(check).toBe(true);
  });

  test("换一个形参：位置不变、其余形参不动", () => {
    type Wire = MapParam<RequiredFace, Marker, MarkerId>;
    type Check = AssertTrue<Equal<Wire["lookup"], (target: MarkerId, note: string) => Marker>>;
    const check: Check = true;
    expect(check).toBe(true);
  });

  test("可选 / rest 形参：元组**原样保留**（不猜，宁可不动也不静默丢位）", () => {
    interface OptionalFace {
      read(target: string, signal?: AbortSignal): string;
      tag(...labels: string[]): number;
    }
    type Dropped = DropParam<OptionalFace, AbortSignal>;
    type OptionalCheck = AssertTrue<
      Equal<Dropped["read"], (target: string, signal?: AbortSignal) => string>
    >;
    const optional: OptionalCheck = true;
    expect(optional).toBe(true);
    type RestCheck = AssertTrue<Equal<Dropped["tag"], (...labels: string[]) => number>>;
    const rest: RestCheck = true;
    expect(rest).toBe(true);
  });

  test("非方法成员不参与投影：只剩方法键", () => {
    type Keys = AssertTrue<Equal<keyof DropParam<RequiredFace, AbortSignal>, "run" | "sync" | "lookup">>;
    const keys: Keys = true;
    expect(keys).toBe(true);
  });

  test("AsyncReturn：`boolean` 返回不能被分配成 `Promise<false> | Promise<true>`（非分配式）", () => {
    interface BoolFace {
      can(): boolean;
    }
    type Wire = AsyncReturn<BoolFace>;
    type Check = AssertTrue<Equal<Wire["can"], () => Promise<boolean>>>;
    const check: Check = true;
    expect(check).toBe(true);
  });

  test("AsyncReturn：流返回（AsyncIterable）不包 Promise——流不是被 await 的值", () => {
    interface StreamFace {
      watch(request: string): AsyncIterable<number>;
    }
    type Wire = AsyncReturn<StreamFace>;
    type Check = AssertTrue<Equal<Wire["watch"], (request: string) => AsyncIterable<number>>>;
    const check: Check = true;
    expect(check).toBe(true);
  });

  test("AsyncReturn：同步返回提升成 Promise，已是 Promise 的不叠两层", () => {
    type Wire = AsyncReturn<RequiredFace>;
    type SyncCheck = AssertTrue<Equal<Wire["sync"], () => Promise<string>>>;
    const sync: SyncCheck = true;
    expect(sync).toBe(true);
    type AsyncCheck = AssertTrue<Equal<Wire["run"], (task: string, signal: AbortSignal) => Promise<void>>>;
    const asyncCheck: AsyncCheck = true;
    expect(asyncCheck).toBe(true);
  });
});
