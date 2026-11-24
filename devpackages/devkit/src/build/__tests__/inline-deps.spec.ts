// `inline` 选项的判据：命中的包（含子路径）打进产物，于是不必出现在 dependencies 里。
// 单测只钉住「谁命中」这件事；产物里究竟有没有那份代码由构建门禁（`just build` + 人工 grep dist）看。
import { describe, expect, test } from "@morlay/zephyr/testing";
import { isInlinedPackage } from "../compile.ts";

describe("isInlinedPackage", () => {
  test("包名与子路径都命中", () => {
    expect(
      isInlinedPackage("@morlay/dsh-client-ui-primitives", ["@morlay/dsh-client-ui-primitives"]),
    ).toBe(true);
    expect(
      isInlinedPackage("@morlay/dsh-client-ui-primitives", ["@morlay/dsh-client-ui-primitives"]),
    ).toBe(true);
  });

  test("前缀相近但不是前缀的 id 不命中", () => {
    expect(
      isInlinedPackage("@morlay/dsh-client-ui-primitives-extra", [
        "@morlay/dsh-client-ui-primitives",
      ]),
    ).toBe(false);
    expect(
      isInlinedPackage("@morlay/dsh-client-ui-conversation", ["@morlay/dsh-client-ui-primitives"]),
    ).toBe(false);
  });

  test("没给 inline 时一律不命中（默认行为不变）", () => {
    expect(isInlinedPackage("@morlay/dsh-client-ui-primitives", undefined)).toBe(false);
    expect(isInlinedPackage("@morlay/dsh-client-ui-primitives", [])).toBe(false);
  });
});
