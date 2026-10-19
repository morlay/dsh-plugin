import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { bootstrapApplication, InjectionToken, resolveServiceByTokenName } from "@morlay/zephyr";
import { TokenMeter } from "@morlay/dsh-base/token-meter";
import { rdbProviders } from "../testing/harness.ts";

describe("diag", () => {
  it("sessions value", async () => {
    const ctx = new Context();
    await bootstrapApplication({
      ctx,
      providers: [
        ...rdbProviders(),
        TokenMeter,
        { provide: new InjectionToken("typert"), useValue: { lookups: { register() {} } } },
      ],
      timeoutMs: 3000,
    }).catch(() => undefined);
    const value = resolveServiceByTokenName(ctx, "session-store") as
      | { constructor?: { name?: string }; list?: unknown }
      | undefined;
    console.log(
      "VALUE",
      JSON.stringify({
        ctor: value?.constructor?.name,
        list: typeof value?.list,
      }),
    );
    expect(true).toBe(true);
  });
});
