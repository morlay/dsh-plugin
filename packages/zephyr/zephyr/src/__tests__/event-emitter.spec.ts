// 类型安全的事件：事件是 `EventEmitter` 的子类，同时是 `@Injectable()` 的 Provider。
//
// 判据是**编译期**：事件名写错、参数个数不对、参数类型不符，都编不过；
// 运行期只验"真的送达了""退订生效""未装配时明确报错"。
import { bootstrapApplication, EventEmitter, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

/** 无参事件。 */
class SessionFlush extends EventEmitter {
  constructor() {
    super("test/session-flush");
  }
}

/** 多参事件：参数表 `[string, number]`。 */
class SessionStatus extends EventEmitter<[string, number]> {
  constructor() {
    super("test/session-status");
  }
}

const opened: App[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose();
});

/** 事件的宿主：事件作为**字段**声明，`$` 后缀统一表示"这是个事件"。 */
class Policy {
  readonly flush$ = new SessionFlush();

  readonly status$ = new SessionStatus();
}

/**
 * 起一个装了这两个事件的 app。
 * @returns 宿主实例（`flush$` / `status$` 已绑定本行 ctx）。
 */
async function boot(): Promise<Policy> {
  const app = await bootstrapApplication({ providers: [SessionFlush, SessionStatus, Policy] });
  opened.push(app);
  return app.get(Policy);
}

describe("EventEmitter", () => {
  it("参数表逐事件独立：多参事件按实参顺序送达", async () => {
    const { status$ } = await boot();
    const got: Array<[string, number]> = [];
    status$.on((id, running) => {
      // 类型来自事件本身：`id` 是 `string`、`running` 是 `number`。
      got.push([id, running]);
    });

    status$.emit("s1", 1);
    expect(got).toEqual([["s1", 1]]);
  });

  it("无参事件与多参事件互不干扰", async () => {
    const { flush$, status$ } = await boot();
    let flushed = 0;
    const seen: string[] = [];
    flush$.on(() => {
      flushed += 1;
    });
    status$.on((id) => seen.push(id));

    status$.emit("s1", 0);
    flush$.emit();
    status$.emit("s2", 2);

    expect(flushed, "无参事件只收到自己那次").toBe(1);
    expect(seen, "多参事件按顺序收到").toEqual(["s1", "s2"]);
  });

  it("退订之后不再送达", async () => {
    const { flush$ } = await boot();
    let count = 0;
    const off = flush$.on(() => {
      count += 1;
    });
    flush$.emit();
    off();
    flush$.emit();
    expect(count).toBe(1);
  });

  it("没装进装配清单的事件：用的时候明确报错，不是静默丢弃", () => {
    // 只有 Provider 实例才由 DI 填 `bus`；直接 `new` 出来的对象里它还是注入占位符。
    const orphan = new SessionFlush();
    expect(() => {
      orphan.emit();
    }).toThrow();
  });

  it("参数个数与类型编不过（`@ts-expect-error` 即判据）", async () => {
    const { flush$, status$ } = await boot();

    // @ts-expect-error 少传一个参数
    status$.emit("s1");
    // @ts-expect-error 参数类型不对
    status$.emit("s1", "not-a-number");
    // @ts-expect-error 多传一个参数
    status$.emit("s1", 1, 2);
    // @ts-expect-error 无参事件不能带参数
    flush$.emit(1);
    // 回调**少写**参数是合法的（JS 允许忽略多余实参），这里只钉参数类型：
    status$.on((only: string, _running: number) => only);

    expect(true).toBe(true);
  });
});
