// @vitest-environment happy-dom
/**
 * 位置族（`@View` + `View.seat` / `View.seat.all`）的模式闭环。
 *
 * 只用 `zephyr-app` 自己的东西：一个根位置占据者声明两个子位置、两个贡献分别挂上去。
 * 业务包（`dsh-session` 等）对接之前，这套模式必须先绿。
 */
import { bootstrapApplication, provide } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { provideClientChain } from "../../provide.ts";
import { provideTheme } from "../../theme/provide.ts";
import { ConfigFormsInMemory } from "../../settings/config-forms.fake.ts";
import { Slots } from "../slots.contract.ts";
import { View } from "../view.tsx";

/** 位置：`main`。 */
@View({ name: "shell.overlay.main" })
abstract class MainView {}

/** 位置：`content`（是否 list 由 `View.seat.all` 决定，不用在这里写）。 */
@View({ name: "shell.overlay.content" })
abstract class ContentView {}

/** 根位置的占据者：两个 seat 字段就是「声明 + 渲染」。 */
@View({ name: "shell.overlay", root: true, id: "demo" })
class LayoutView {
  readonly main = View.seat(MainView);

  readonly contents = View.seat.all(ContentView);

  render(): JSX.Element {
    return (
      <div data-demo="">
        {this.main}
        <div data-demo-list="">{this.contents}</div>
      </div>
    );
  }
}

/** 子位置的贡献（位置由 `extends` 决定）。 */
@View()
class DemoView extends MainView {
  render(): JSX.Element {
    return <span data-demo-main="">main</span>;
  }
}

/** list 位置的贡献。 */
@View({ id: "third" })
class ThirdPartyContribution extends ContentView {
  render(): JSX.Element {
    return <b data-demo-third="">third</b>;
  }
}

const provideDemo = provide([
  ...provideClientChain(),
  ...provideTheme(),
  ConfigFormsInMemory,
  LayoutView,
  DemoView,
  ThirdPartyContribution,
]);

describe("位置族（@View + View.seat）", { timeout: 10_000 }, () => {
  it("seat 字段既声明子位置、又能渲染它的贡献", async () => {
    const app = await bootstrapApplication({ providers: [...provideDemo()], timeoutMs: 8_000 });
    try {
      const slots = app.get(Slots);
      // 注册要等「位置声明 → 贡献注册 → 再声明子位置」几拍，多等几轮 tick。
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      // 两个子位置都因 `seat` 字段而被声明，贡献挂在上面。
      const main = slots.entries("shell.overlay.main" as never);
      const contents = slots.entries("shell.overlay.content" as never);
      console.debug("[nesting] main =", main.length, "contents =", contents.length);
      expect(main.length, "main 上应有贡献").toBeGreaterThan(0);
      expect(contents.length, "content 上应有贡献").toBeGreaterThan(0);
    } finally {
      await app.dispose();
    }
  });
});
