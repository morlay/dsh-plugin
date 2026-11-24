// 按 scope 装配：Provider 自己声明 scope（`@Injectable({ scope })`），装配器把带 scope 的行**不装
// 应用根**，而是按 scope 分组交还给宿主，由宿主在它指定的 ctx 上装（agent 域就是每个 agent 的
// `agentCtx`）。
//
// 两条判据：
// 1. **事件字段绑的是"装这一行时用的那个 ctx"**——行的事件令牌 `bus` 就是传入的 ctx，订阅随之落在
//    那个 ctx 的 scope 里（不需要谁把 ctx 显式传下去）；
// 2. **scope 决定位置**——带 scope 的行不出现在应用根，只能经 `ScopedRows.install` 装到某个 ctx 上。
// 这份 `Context` 是**类 + 模块增强**（`fiber` / `set` / `accessor` 都在它上面），
// 而裸包名 `@deepseek-ai/cordis` 导出的是类型面、不能 `new`——所以按 `src/context.ts` 引。
import { Context as CordisContext } from "@deepseek-ai/cordis/src/context.ts";
import {
  bootstrapApplication,
  EventEmitter,
  Injectable,
  mountRow,
  ScopedRows,
  type Context,
} from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

/** 声明方定的分类键（装配器只认 symbol，不解释它的含义）。 */
const ScopeDemo = Symbol.for("test.scope.demo");

// `ctx.emit("test/ping")` 走 cordis 的 `Context.emit`，签名收 `keyof Events`——给那个模块路径补一条。
// 注意模块路径要与本文件的 import 一致（裸包名与 `src/events.ts` 是两个模块实例）。
declare module "@deepseek-ai/cordis/src/events.ts" {
  interface Events {
    "test/ping": [];
  }
}

/** 无参事件：谁在自己的 scope 上派发，只有那个 scope 的订阅者收到。 */
class Ping extends EventEmitter {
  constructor() {
    super("test/ping");
  }
}

/** 带事件字段的行（事件的宿主，与业务实现同一个实例）。 */
@Injectable()
class PingRow {
  readonly ping$ = new Ping();
}

/**
 * 落在 demo scope 里的行：订阅写在 `onInit` 里，落在**装它的那个 ctx** 上。
 * @param seen - 本用例自己的探针数组（谁收到了派发）。
 * @returns 行类。
 */
function scopedPingRowOf(seen: string[]) {
  @Injectable({ scope: ScopeDemo })
  class ScopedPingRow {
    readonly ping$ = new Ping();

    onInit(): void {
      // 字段事件在 `onInit` 之前已绑好本行 ctx，这里直接订阅即可。
      this.ping$.on(() => seen.push("scoped"));
    }
  }
  return ScopedPingRow;
}

/**
 * 只记一次 `onInit`：判据是它**没有**出现在应用根上。
 * @param installed - 本用例自己的探针数组（记录 `onInit` 跑过）。
 * @returns 行类。
 */
function rootlessRowOf(installed: string[]) {
  @Injectable({ scope: ScopeDemo })
  class RootlessRow {
    onInit(): void {
      installed.push("scoped");
    }
  }
  return RootlessRow;
}

/** 普通行：用来占住应用根，证明清单里两类行可以并存。 */
@Injectable()
class RootRow {}

/**
 * 造一个裸 ctx（模拟"某个宿主 scope"，本包不依赖任何具体宿主）。
 * @returns 根 ctx。
 */
function freshContext(): Context {
  const ctx = new CordisContext();
  onTestFinished(() => ctx.fiber.dispose());
  // 单断言收窄：我们的 `Context` 是 cordis ctx 的子类型（只补了运行时本来就有的成员）。
  return ctx as unknown as Context;
}

describe("按 scope 装配", () => {
  test("mountRow 装的行：事件字段绑传入的 ctx，订阅不抛、emit 能收到", async () => {
    const ctx = freshContext();
    const row = await mountRow(ctx, PingRow);
    const seen: string[] = [];
    // 判据：这里不抛「装配完成前被使用」。
    (row.instance as PingRow).ping$.on(() => seen.push("ping"));
    ctx.emit("test/ping");
    expect(seen).toEqual(["ping"]);
  });

  test("带 scope 的行不装应用根：只能经 ScopedRows.install 装到指定 ctx", async () => {
    const installed: string[] = [];
    const app = await bootstrapApplication({
      providers: [rootlessRowOf(installed), RootRow],
    });
    onTestFinished(() => app.dispose());
    const rows = app.get(ScopedRows);
    expect(rows.scopes, "清单里声明过的 scope").toEqual([ScopeDemo]);
    expect(installed, "应用根上没有它").toEqual([]);

    const scopedCtx = freshContext();
    await rows.install(ScopeDemo, scopedCtx);
    expect(installed).toEqual(["scoped"]);
  });

  test("带 scope 的行：事件订阅落在传入的 ctx 上，根的派发收不到", async () => {
    const scopedSeen: string[] = [];
    const app = await bootstrapApplication({ providers: [scopedPingRowOf(scopedSeen)] });
    onTestFinished(() => app.dispose());
    const scopedCtx = freshContext();
    await app.get(ScopedRows).install(ScopeDemo, scopedCtx);

    (app.ctx as unknown as { emit(name: string): void }).emit("test/ping");
    expect(scopedSeen, "根上的派发不进这个 scope").toEqual([]);

    // 我们的 `Context` 类型面没加载 cordis 的 `Events` 增强，`emit` 的参数是 `never`；
    // 运行期它就是同一个对象——按「有 emit 的形状」收窄一次。
    (scopedCtx as unknown as { emit(name: string): void }).emit("test/ping");
    expect(scopedSeen, "本 scope 的派发收得到").toEqual(["scoped"]);
  });
});
