// @vitest-environment happy-dom
/**
 * `@Slot` 的两种贡献来源：options 放**静态**值，需要 `inject()` 的写**类方法**。
 *
 * 这条用例守两件事：①类方法在应用期能读到已就位的注入；②撤销真的回收（再装一次不冲突）。
 *
 * 关键在 `extends SlotContribution`：**没有它 `slotRoot()` 根本不会被调用**，断言就成了
 * 「装配没炸」；贡献方法的返回值也就没人读。
 */
import { bootstrapApplication, inject, Injectable, type App } from "@morlay/zephyr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Slots } from "../slots.contract.ts";
import { SlotsDefault } from "../slots.service.ts";
import { Slot, SlotContribution } from "../slot.decorator.ts";

@Injectable()
abstract class Probe {
  abstract readonly label: string;
}

@Injectable()
class ProbeDefault extends Probe {
  readonly label = "probe-value";
}

/** `slotRoot()` 在应用期读到的注入值（用例断言它真的被读到了）。 */
let seenProbe: string | undefined;

/** 同 key 的两份 scope adapter：类方法应该覆盖 options 的静态值。 */
const staticScope = { kind: "static" };
const methodScope = { kind: "method" };

@Slot({})
class Contributor extends SlotContribution {
  readonly probe = inject(Probe);

  slotRoot(): { props: Record<string, unknown> } {
    seenProbe = this.probe.label;
    return { props: { probe: this.probe.label } };
  }
}

@Slot({ scope: { session: staticScope } as never })
class Merged extends SlotContribution {
  slotScope(): Readonly<Record<string, Parameters<Slots["installScope"]>[1]>> {
    return { session: methodScope as never };
  }
}

let app: App;
let slots: Slots;

beforeAll(async () => {
  app = await bootstrapApplication({
    providers: [SlotsDefault, ProbeDefault, Contributor, Merged],
    timeoutMs: 8_000,
  });
  slots = app.get(Slots);
});

afterAll(async () => {
  await app.dispose();
});

describe("@Slot 的贡献来源", { timeout: 10_000 }, () => {
  it("类方法（slotRoot）在应用期读到注入的依赖", () => {
    expect(seenProbe, "slotRoot 没被调用（或注入没就位）").toBe("probe-value");
  });

  it("options 的静态贡献与类方法贡献合并：同 key 由类方法覆盖，只装一次", () => {
    // 装两次会抛 "slot scope 'session' already has an adapter"——装配成功即「只装一次」。
    expect(slots.scope("session")).toBe(methodScope);
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
