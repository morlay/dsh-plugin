// 装配顺序：**由 inject 声明决定，不由清单写法决定**。
//
// 这条用例钉住「提供者写在消费者后面也能装对」——清单位置只影响同层次序。
import { describe, expect, it } from "vitest";
import { bootstrapApplication, Injectable, inject } from "../index.ts";

@Injectable()
abstract class Dep {
  abstract readonly ok: boolean;
}

@Injectable()
class DepRow extends Dep {
  readonly ok = true;
}

@Injectable()
class ConsumerRow {
  private readonly dep = inject(Dep);

  get value(): boolean {
    return this.dep.ok;
  }
}

describe("装配顺序", () => {
  it("清单把消费者写在提供者前面，仍然先装提供者（拓扑排序）", async () => {
    const app = await bootstrapApplication({ providers: [ConsumerRow, DepRow] });
    try {
      expect(app.get(ConsumerRow).value).toBe(true);
    } finally {
      await app.dispose();
    }
  });
});
