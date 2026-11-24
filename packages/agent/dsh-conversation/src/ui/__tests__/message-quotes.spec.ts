/**
 * 选中消息文本 →「引用文本」浮层（上游 `message-quotes` 的浏览器半）装上了没有。
 *
 * 判据是它往两个槽位注册的那两条：
 * - `conversation.chat.text-interaction` / `key: 'quote'`——选中模型回答文本时那个浮层（用户报的就是它）；
 * - `conversation.user.text.node` / `key: 'quote'`——用户消息里已引用的片段。
 *
 * 两处位置分别由 `ui-chat` 与 `ui-conversation` 声明；本 spec 只装这一行，所以按同一形状声明一次。
 * 「不装这一行 → 两个槽位都空」是这条 spec 的反向判据（见 `withRow: false`）。
 */
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { Locale, provideRenderer, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { describe, expect, test } from "@morlay/dsh-conversation/testing";
import { onTestFinished } from "vitest";
import { UiConversation } from "../conversation/conversation.token.ts";
import { MessageQuotesSlot } from "../conversation/message-quotes-slot.ts";

/** 等条件成立（槽位注册要等位置声明）。 */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  for (let waited = 0; !check() && waited < timeoutMs; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 语言替身：本 spec 只看注册项，不看文案。 */
@Injectable()
class FakeLocale extends Locale {
  readonly bind: Locale["bind"] = () =>
    ((key: string) => `quote:${key}`) as ReturnType<Locale["bind"]>;

  readonly register: Locale["register"] = () => () => {};

  readonly getSnapshot: Locale["getSnapshot"] = () => ({
    active: "zh" as ReturnType<Locale["getSnapshot"]>["active"],
    locales: [],
    revision: 0,
  });

  readonly subscribe: Locale["subscribe"] = () => () => {};
}

/**
 * 起装配，并声明这一行要注册的两个槽位。
 * @param withRow - 是否装 `MessageQuotesSlot`（`false` 是反向判据：两个槽位都该空）。
 * @returns `Slots`。
 */
async function boot(withRow: boolean): Promise<Slots> {
  const app = await bootstrapApplication({
    providers: [
      ...provideRenderer(),
      FakeLocale,
      { provide: SessionController, useFactory: () => ({}) },
      {
        provide: UiConversation,
        useFactory: () => ({
          userText: { register: () => () => {} },
          interactions: { register: () => () => {} },
        }),
      },
      ...(withRow ? [MessageQuotesSlot] : []),
    ],
    timeoutMs: 10_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  const slots = app.get(Slots);
  // 两处位置的形状照抄声明方（`ui-chat` 的 chat 视图 children / `ui-conversation` 的 user.text.node）。
  slots.registerDynamic(
    {
      name: "root",
      children: {
        "conversation.chat.text-interaction": { kind: "keyed", scope: "session" },
        "conversation.user.text.node": { kind: "keyed", scope: "session", inline: true },
      },
    },
    () => null,
  );
  return slots;
}

/** 槽位里注册项的键（keyed 槽位按 `key` 落，见 `slots.register` 的 options）。 */
function keysOf(slots: Slots, name: string): (string | undefined)[] {
  return (
    slots.entries(name as never) as readonly { readonly options?: { readonly key?: string } }[]
  ).map((entry) => entry.options?.key);
}

describe("选中引用的「引用文本」浮层", () => {
  test("装上之后两个槽位都有 quote 注册项", async () => {
    const slots = await boot(true);
    await until(() => keysOf(slots, "conversation.chat.text-interaction").length > 0);
    expect(
      keysOf(slots, "conversation.chat.text-interaction"),
      "选中模型回答文本时那个浮层就是这条注册项（没有 = 用户报的「没有」）",
    ).toEqual(["quote"]);
    await until(() => keysOf(slots, "conversation.user.text.node").length > 0);
    expect(keysOf(slots, "conversation.user.text.node"), "已引用的用户文本靠这条渲染").toEqual([
      "quote",
    ]);
  });

  test("不装这一行时两个槽位都是空的（反向判据）", async () => {
    const slots = await boot(false);
    expect(keysOf(slots, "conversation.chat.text-interaction")).toEqual([]);
    expect(keysOf(slots, "conversation.user.text.node")).toEqual([]);
  });
});
