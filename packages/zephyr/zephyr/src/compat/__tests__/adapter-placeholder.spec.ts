import { Service } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { bootstrapApplication, inject, Injectable } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

// 上游实现：一个普通 Service（`super(ctx, name)` 即注册）。
class Upstream extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0]) {
    super(ctx, "seam");
  }

  value(): string {
    return "real";
  }
}

// 契约：只是抽象结构（不继承 Service）。
@Injectable()
abstract class SeamContract {
  abstract value(): string;
}

// 我们的适配：令牌是契约，上游实现被挂载进来。
@Injectable()
class Seam extends fromCordis(SeamContract, Upstream) {}

// 消费方：**在适配之前**装配，字段注入拿到的不应是适配类的占位实例。
@Injectable()
class Consumer {
  seam = inject(SeamContract);
}

describe("适配类占位：inject(契约) 必须等到上游实例", () => {
  it("先装配的消费方也能拿到上游实例", async () => {
    const app = await bootstrapApplication({ providers: [Consumer, Seam] });
    const direct = app.get(Seam);
    expect(direct.value()).toBe("real");
    expect(app.get(Consumer).seam.value()).toBe("real");
    await app.dispose();
  }, 12000);

  it("反过来的顺序同样成立", async () => {
    const app = await bootstrapApplication({ providers: [Seam, Consumer] });
    expect(app.get(Consumer).seam.value()).toBe("real");
    await app.dispose();
  }, 12000);
});
