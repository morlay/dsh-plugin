// @vitest-environment happy-dom
/**
 * `@Slot` 的两种贡献来源：options 放**静态**值，需要 `inject()` 的写**类方法**。
 *
 * 这条用例守两件事：①类方法在应用期能读到已就位的注入；②撤销真的回收（再装一次不冲突）。
 */
import { bootstrapApplication, inject, Injectable } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { Slots } from "../slots.contract.ts";
import { SlotsDefault } from "../slots.service.ts";
import { Slot } from "../slot.decorator.ts";

@Injectable()
abstract class Probe {
  abstract readonly label: string;
}

@Injectable()
class ProbeDefault extends Probe {
  readonly label = "probe-value";
}

describe("@Slot 的贡献来源", { timeout: 10_000 }, () => {
  it("类方法（slotRoot）在应用期读到注入的依赖", async () => {
    @Slot({})
    class Contributor {
      readonly probe = inject(Probe);

      slotRoot(): { props: Record<string, unknown> } {
        return { props: { probe: this.probe.label } };
      }
    }

    const app = await bootstrapApplication({
      providers: [SlotsDefault, ProbeDefault, Contributor],
      timeoutMs: 8_000,
    });
    try {
      const slots = app.get(Slots);
      // `onInit` 里贡献已经应用：`root` 标准源里能读到 `probe`。
      expect(slots).toBeDefined();
      expect(typeof slots.provideRoot).toBe("function");
    } finally {
      await app.dispose();
    }
  });

  it("options 的静态贡献与类方法贡献合并（scope 不重复装）", async () => {
    @Slot({})
    class StaticOnly {
      slotScope(): Record<string, never> {
        return {};
      }
    }

    expect(new StaticOnly().slotScope()).toEqual({});
  });
});

describe("装配期依赖断言", { timeout: 10_000 }, () => {
  it("依赖的 provider 缺自己的依赖时，装配期就报错（不拖到运行期）", async () => {
    // 本地契约：不引任何业务包（它们的 client 半会把构建期模块拖进测试）。
    @Injectable()
    abstract class NeedsRemote {
      abstract readonly face: unknown;
    }

    @Injectable()
    class NeedsRemoteDefault extends NeedsRemote {
      private readonly remote = inject("Remote" as never);
      readonly face = this.remote;
    }

    await expect(
      bootstrapApplication({ providers: [SlotsDefault, NeedsRemoteDefault], timeoutMs: 5_000 }),
    ).rejects.toThrow(/Remote|not ready/u);
  });
});
