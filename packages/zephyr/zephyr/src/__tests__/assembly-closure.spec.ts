// 装配闭环：**装配期就该抛的错**，不等运行期。
//
// 这一组不测业务行为，只钉「装不起来的情形会不会当场报」——用户实测过的两类都栽在这里：
// 1. 同名服务注册两次（`service "X" has been registered at <fiber>`）——`uiWorkspace` 那次；
// 2. 缺提供者（`没有提供者：X（Y 需要它）`）——`TerminalEndpointClient` 漏进清单那次。
import { bootstrapApplication, inject, Injectable, InjectionToken } from "@morlay/zephyr";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

const Duplicated = new InjectionToken<{ readonly ok: boolean }>("contract.duplicated");
const Missing = new InjectionToken<{ readonly ok: boolean }>("contract.missing");

/** 依赖一个**没人提供**的令牌：装配期就该红，而不是运行期拿到 `undefined`。 */
@Injectable()
class NeedsMissing {
  readonly missing = inject(Missing);
}

describe("装配期就该抛的错", { timeout: 15_000 }, () => {
  test("同名服务注册两次：当场抛，消息里带 fiber", async () => {
    await expect(
      bootstrapApplication({
        providers: [
          { provide: Duplicated, useValue: { ok: true } },
          { provide: Duplicated, useValue: { ok: false } },
        ],
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/already been registered|has been registered/u);
  });

  test("缺提供者：**编译期**就红（`__missingProviders` 缺那个令牌）", () => {
    // 这条的判据是**类型**，不是运行期异常：`bootstrapApplication` 的清单条目带
    // `__missingProviders` 的品牌，少了提供者时实参直接不可赋值。
    // 运行期那条兜底（`没有提供者：X（Y 需要它）`）由 `assembly.spec.ts` 的既有用例守着。
    // @ts-expect-error 装配清单里没有 `Missing` 的条目：编译期就该报错
    void (() => bootstrapApplication({ providers: [NeedsMissing], timeoutMs: 5_000 }));
  });

  test("同一行重挂：服务只注册一次，不抛「has been registered」", async () => {
    // 这条钉的是 `workspace-slots` 那种「行里已经拿到的服务，别再往根上补发一次」——
    // 补发就会撞。装配两次**同一个 Provider 清单**是合法的（两个 app 各自的 fiber）。
    const first = await bootstrapApplication({
      providers: [{ provide: Duplicated, useValue: { ok: true } }],
      timeoutMs: 5_000,
    });
    onTestFinished(() => first.dispose().catch(() => {}));
    const second = await bootstrapApplication({
      providers: [{ provide: Duplicated, useValue: { ok: true } }],
      timeoutMs: 5_000,
    });
    onTestFinished(() => second.dispose().catch(() => {}));
    expect(second.get(Duplicated)).toEqual({ ok: true });
  });
});
