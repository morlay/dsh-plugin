/**
 * `@Slot` 的两种贡献来源：options 放**静态**值，需要 `inject()` 的写**类方法**。
 *
 * 这条用例守两件事：①类方法在应用期能读到已就位的注入；②撤销真的回收（再装一次不冲突）。
 *
 * 关键在 `extends SlotContribution`：**没有它 `slotRoot()` 根本不会被调用**，断言就成了
 * 「装配没炸」；贡献方法的返回值也就没人读。
 */
import { bootstrapApplication, inject, Injectable } from "@morlay/zephyr";
import { describe, expect, test as base } from "@morlay/zephyr-app/testing";
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

/**
 * 探针容器：`slotRoot()` 在应用期把读到的注入值写进来，用例断言它真的被读到了。
 *
 * 是**装配里的一份值**而不是模块级变量：谁装配谁持有，用例之间不会互相看到。
 */
@Injectable()
class ProbeLog {
  seen: string | undefined;
}

/** 同 key 的两份 scope adapter：类方法应该覆盖 options 的静态值。 */
const staticScope = { kind: "static" };
const methodScope = { kind: "method" };

@Slot({})
class Contributor extends SlotContribution {
  readonly probe = inject(Probe);

  private readonly log = inject(ProbeLog);

  slotRoot(): { props: Record<string, unknown> } {
    this.log.seen = this.probe.label;
    return { props: { probe: this.probe.label } };
  }
}

@Slot({ scope: { session: staticScope } as never })
class Merged extends SlotContribution {
  slotScope(): Readonly<Record<string, Parameters<Slots["installScope"]>[1]>> {
    return { session: methodScope as never };
  }
}

/** 一份装配：契约面 + 探针容器（谁请求谁得到一份，用例结束随装配关）。 */
interface SlotFixtures {
  readonly slotApp: { readonly slots: Slots; readonly probeLog: ProbeLog };
}

const test = base.extend<SlotFixtures>({
  async slotApp({}, use) {
    const probeLog = new ProbeLog();
    const app = await bootstrapApplication({
      providers: [
        SlotsDefault,
        ProbeDefault,
        Contributor,
        Merged,
        { provide: ProbeLog, useValue: probeLog },
      ],
      timeoutMs: 8_000,
    });
    await use({ slots: app.get(Slots), probeLog });
    await app.dispose();
  },
});

describe("@Slot 的贡献来源", { timeout: 10_000 }, () => {
  test("类方法（slotRoot）在应用期读到注入的依赖", ({ slotApp }) => {
    expect(slotApp.probeLog.seen, "slotRoot 没被调用（或注入没就位）").toBe("probe-value");
  });

  test("options 的静态贡献与类方法贡献合并：同 key 由类方法覆盖，只装一次", ({ slotApp }) => {
    // 装两次会抛 "slot scope 'session' already has an adapter"——装配成功即「只装一次」。
    expect(slotApp.slots.scope("session")).toBe(methodScope);
  });
});

describe("装配期依赖断言", { timeout: 10_000 }, () => {
  test("依赖的 provider 缺自己的依赖时，装配期就报错（不拖到运行期）", async () => {
    // 本地契约：不引任何业务包（它们的 client 半会把构建期模块拖进测试）。
    @Injectable()
    abstract class NeedsRemote {
      abstract readonly face: unknown;
    }

    // 另一个契约：本用例里没有提供者，注入它必须在装配期就报错。
    @Injectable()
    abstract class RemoteFace {
      abstract readonly invoke: unknown;
    }

    @Injectable()
    class NeedsRemoteDefault extends NeedsRemote {
      // 注入**契约**，不是字符串：`inject` 收的是令牌，名字只是装配期的事。
      private readonly remote = inject(RemoteFace);
      readonly face = this.remote;
    }

    // 手写 try/catch：`rejects.toThrow` 会去格式化错误里挂着的注入占位代理，读它的属性会抛。
    // `@ts-expect-error`：这条用例要的就是「缺依赖」——`bootstrapApplication` 的编译期检查会拒绝它，
    // 断言的正是运行期也拒绝（两处都得拦）。
    let message = "";
    try {
      // @ts-expect-error 缺 RemoteFace 的提供者：这是用例的前提。
      await bootstrapApplication({
        providers: [SlotsDefault, NeedsRemoteDefault],
        timeoutMs: 5_000,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/没有提供者|Remote/u);
  });
});
