import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import {
  AgentProviderGroup,
  AgentScoped,
  isAgentScoped,
} from "../index.ts";

/** 契约。 */
@Injectable()
abstract class ScopedThing {
  abstract readonly kind: string;
}

/** 实现：声明自己按 agent 的 scope 分层。 */
@AgentScoped()
@Injectable()
class ScopedThingDefault extends ScopedThing {
  readonly kind = "scoped";
}

/** 域贡献：把这个域里 per-agent 的东西登记到 `AgentProviderGroup`。 */
@Injectable({ multi: true })
class ScopedThingGroup extends AgentProviderGroup {
  readonly entries = [ScopedThingDefault];
}

describe("per-agent 插件的贡献面", () => {
  it("`@AgentScoped()` 打标记，`AgentProviderGroup` 拍平出清单，装配后能注入", async () => {
    expect(isAgentScoped(ScopedThingDefault), "装饰器写下静态标记").toBe(true);
    expect(isAgentScoped(ScopedThing), "契约上没打标记").toBe(false);

    const app = await bootstrapApplication({
      providers: [ScopedThingGroup, ScopedThingDefault],
    });
    try {
      const contributions = app.getAll(AgentProviderGroup);
      expect(contributions.map((one) => one.entries.flat())).toEqual([[ScopedThingDefault]]);
      // 这类插件**装在 root**（分层需要全局实例），不是每 agent 一份。
      expect(app.get(ScopedThing).kind).toBe("scoped");
    } finally {
      await app.dispose();
    }
  });

  it("漏登记也能装（标记不影响装配），但清单里查得到谁漏了", async () => {
    /** 另一个按 agent 分层的实现，域里忘了登记。 */
    @AgentScoped()
    @Injectable()
    class OrphanThing extends ScopedThing {
      readonly kind = "orphan";
    }

    const app = await bootstrapApplication({ providers: [OrphanThing] });
    try {
      expect(app.get(ScopedThing).kind, "标记不拦装配").toBe("orphan");
      expect(
        app.getAll(AgentProviderGroup).flatMap((one) => one.entries),
        "清单里没有它——这就是要检查的东西",
      ).toEqual([]);
    } finally {
      await app.dispose();
    }
  });
});
