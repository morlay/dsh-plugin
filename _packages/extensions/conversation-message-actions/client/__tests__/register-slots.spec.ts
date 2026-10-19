// 真装配守护：我们这两个 keyed 渲染器的**槽注册面**。
//
// 为什么值得一条真装配用例：`conversation.chat.user.images` 的声明权归上游工厂
// `conversation.chat.user.content`（`ui-chat/src/client/apply.ts` 的 registerFactory），而槽的声明是**独占**的
// ——重复声明必抛 `slot "…" is already declared`。抛在 `slots.inject` 的回调里，整个渲染器就静默回落到官方那份：
// 消息照常显示、我们加的编辑/重试入口整条消失（组件测试看不见这种失败，它直接给 props）。
import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import { registerChatNodeRenderers } from "../chat-node/register.ts";

const Comp = () => null;

/** 只转发的 slots 面：`inject` 等的是"这个槽有人声明了"，装配里那一步由上游行完成。 */
function slotsFacade(core: SlotCore): Context {
  return {
    slots: {
      inject: (name: string, callback: () => unknown) => {
        if (core.specDynamic(name) === undefined) throw new Error(`slot "${name}" is not declared`);
        return callback();
      },
      register: (options: unknown, component: unknown) =>
        core.register(options as never, component as never),
    },
  } as unknown as Context;
}

describe("chat-node 的槽注册面", () => {
  it("上游工厂声明了 user.images 之后，注册仍成功且 user / steering 都在", () => {
    const core = new SlotCore();
    core.register(
      {
        name: "root",
        children: { "conversation.chat.node": { kind: "keyed", scope: "session" } },
      } as never,
      Comp as never,
    );
    // 上游那一行：工厂独占声明 `conversation.chat.user.images`。
    core.registerFactory(
      {
        name: "conversation.chat.user.content",
        scope: "session",
        children: { "conversation.chat.user.images": { kind: "single", scope: "session" } },
      } as never,
      Comp as never,
    );

    expect(() =>
      registerChatNodeRenderers(slotsFacade(core), () => ({ face: {} }) as never),
    ).not.toThrow();
    const entries = core.entries("conversation.chat.node");
    // 两条 keyed entry 都在（顺序不参与判定：注册顺序是内部细节）。
    expect(
      entries
        .map((entry) => entry.options.key)
        .sort((left, right) => String(left).localeCompare(String(right))),
    ).toEqual(["steering", "user"]);
    for (const entry of entries) {
      // 覆盖官方那两条的注册面：priority 更低（lowest renders，我们这份生效）、locale 与行一致、
      // inject 面在场（编辑 / 重试的 face 从这里来）。
      expect(entry.options.priority).toBe(-1);
      expect(entry.locale).toBe("conversation");
      expect(typeof entry.inject).toBe("function");
      expect(entry.children).toBeUndefined();
    }
    // 我们没有把那个槽的声明权抢过来（抢了上游工厂就注册不上了）。
    expect(core.spec("conversation.chat.user.images")).toMatchObject({
      kind: "single",
      scope: "session",
    });
  });
});
