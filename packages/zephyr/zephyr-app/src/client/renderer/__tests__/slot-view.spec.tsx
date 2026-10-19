// @vitest-environment happy-dom
/**
 * `@SlotProvider` / `@SlotView`：位置由**类型**决定（`extends XSlot`），视图只实现 `render()`。
 *
 * 这条用例守的是「没有手写 slot 字符串」：`slotViewOf(View)` 给出的名字必须来自它 extends 的抽象类。
 */
import { describe, expect, it } from "vitest";
import { SlotProvider, SlotView, slotViewOf } from "../slot-view.tsx";

describe("@SlotProvider / @SlotView", () => {
  it("位置名来自 extends 的抽象类，视图自身不写字符串", () => {
    @SlotProvider({ name: "sidebar.left", multi: true })
    abstract class SidebarSlot {}

    @SlotView()
    class SessionList extends SidebarSlot {
      readonly sessions = "sessions";

      render(): unknown {
        return null;
      }
    }

    expect(slotViewOf(SessionList)?.name).toBe("sidebar.left");
    expect(slotViewOf(SessionList)?.component).toBeTypeOf("function");
  });

  it("视图没有 extends @SlotProvider 时明确报错", () => {
    expect(() => {
      @SlotView()
      class Orphan {
        render(): unknown {
          return null;
        }
      }
      return Orphan;
    }).toThrow(/必须 extends/u);
  });
});

describe("@SlotView 的依赖", () => {
  it("依赖走视图类属性上的 inject()（与其它 Provider 同一写法）", () => {
    @SlotProvider({ name: "sidebar.right" })
    abstract class RightSlot {}

    @SlotView()
    class Detail extends RightSlot {
      readonly label = "detail";

      render(): unknown {
        return null;
      }
    }

    expect(slotViewOf(Detail)?.name).toBe("sidebar.right");
  });
});
