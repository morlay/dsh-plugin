/**
 * `AssertWireFace` 的判别力：**用内联假类型**测。四条——精确、形参放宽、返回说窄、缺键；
 * 并且同时钉住「为什么不能用 `AssertCoveredStrict` / `implements`」：同一份放宽形状在它们那边是 `true`。
 */
import { describe, expect, test } from "@morlay/zephyr/testing";
import type { AssertCoveredStrict, AssertWireFace } from "../contract-coverage.ts";

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;

type AssertTrue<T extends true> = T;

interface Attachment {
  readonly kind: "image";
}

interface Descriptor {
  readonly name: string;
}

interface Result {
  readonly commandId: string;
}

/** 上游 wire 面（形参 branded id、响应含 `undefined`）。 */
interface Wire {
  execute(atts: readonly Attachment[]): Promise<Result | undefined>;
  list(sessionId: string): Promise<readonly Descriptor[]>;
}

describe("AssertWireFace 的判别力", () => {
  test("精确对上 → true", () => {
    type Check = AssertTrue<Equal<AssertWireFace<Wire, Wire>, true>>;
    const check: Check = true;
    expect(check).toBe(true);
  });

  test("形参放宽（readonly unknown[]）→ 报 execute；同一形状在单向守卫那边是 true（这就是漏洞）", () => {
    interface Widened {
      execute(atts: readonly unknown[]): Promise<Result | undefined>;
      list(sessionId: string): Promise<readonly Descriptor[]>;
    }
    type Caught = AssertTrue<Equal<AssertWireFace<Wire, Widened>, "execute">>;
    const caught: Caught = true;
    expect(caught).toBe(true);
    // 单向关系看不见放宽：`Widened` 的成员能放进 `Wire` 的位置，`AssertCoveredStrict` 于是全绿。
    type Hole = AssertTrue<Equal<AssertCoveredStrict<Wire, Widened>, true>>;
    const hole: Hole = true;
    expect(hole).toBe(true);
  });

  test("返回说窄了（声称不返回 undefined）→ 报 execute", () => {
    interface Narrowed {
      execute(atts: readonly Attachment[]): Promise<Result>;
      list(sessionId: string): Promise<readonly Descriptor[]>;
    }
    type Caught = AssertTrue<Equal<AssertWireFace<Wire, Narrowed>, "execute">>;
    const caught: Caught = true;
    expect(caught).toBe(true);
  });

  test("契约掉了端点 → 报名（漏的那一个）", () => {
    interface Missing {
      execute(atts: readonly Attachment[]): Promise<Result | undefined>;
    }
    type Caught = AssertTrue<Equal<AssertWireFace<Wire, Missing>, "list">>;
    const caught: Caught = true;
    expect(caught).toBe(true);
  });
});
