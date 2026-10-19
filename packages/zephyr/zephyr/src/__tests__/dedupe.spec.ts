// 装配合并的去重键是**实现类身份**（`providerBase`），不是令牌名、也不是配置：
// 同一个实现配两次只剩最后一条——所以「同一个类要出现两行」时必须写两个类。
//
// 这条属于框架语义（`dedupeProviders` 是内部实现，不出包出口），测试留在框架包里，
// 用假实现验证，不拉业务依赖。
import { configure, dedupeProviders, Injectable } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

@Injectable()
class Row {
  constructor(readonly config: { readonly label: string }) {}
}

@Injectable()
class ForkRow {
  constructor(readonly config: { readonly label: string }) {}
}

describe("装配合并的去重键", () => {
  it("同一个实现配两次 → 只剩一条", () => {
    const merged = dedupeProviders([
      ...configure(Row, { label: "first" })([Row]),
      ...configure(Row, { label: "second" })([Row]),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("两个实现各配一次 → 两条都在（行名相同也不合并）", () => {
    const [first] = configure(Row, { label: "first" })([Row]);
    const [second] = configure(ForkRow, { label: "second" })([ForkRow]);
    const merged = dedupeProviders([first!, second!]);
    expect(merged).toHaveLength(2);
    expect(merged).toContain(first);
    expect(merged).toContain(second);
  });
});
