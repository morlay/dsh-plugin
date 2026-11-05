// 侧栏「添加工作区」的目录选择（client 行）：打开**宿主屏幕上**的系统目录对话框。
//
// 交互归上游：占用项是上游 `NativeDirectoryFlow`（无渲染，`open` 上升沿调一次 pick），
// pick 走 `uiWorkspace.pickDirectory()` → `remote.directoryPicker.pick()` → 宿主 native chooser。
//
// 为什么不用上游 `ui-directory-picker-native` 的 `apply`：它把「侧栏」与「`conversation.hero.workspace`」
// 两个 directory-flow 洞绑成一个事务，外层要等 `conversation.hero` 的声明——那个位置属于 `ui-conversation`，
// 我们还没装（位置只能由父条目的 children 表声明，`@View` 位置类声明不出来）。于是这里只注册侧栏那个洞。
// 装 `ui-conversation` 之后，换成上游的 `apply` 即可，本行整份删除。
import { NativeDirectoryFlow } from "@deepseek-ai/dsh-client-ui-directory-picker-native/src/client/flow.ts";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { Slots } from "@morlay/zephyr-app/client";
import { UiWorkspace } from "./ui-workspace.token.ts";

/** 占用项的注入面（与上游 `NativeFlowInjected` 同形）。 */
interface NativeFlowFace {
  pick: () => Promise<string | null>;
}

@Injectable()
export class DirectoryPickerNativeSlots implements OnInit, OnDispose {
  private readonly slots = inject(Slots);

  private readonly uiWorkspace = inject(UiWorkspace);

  private readonly disposers: (() => void)[] = [];

  /** 正在飞的那次选择：并发/重复的 `pick` 共用它（一次点击只该有一个宿主请求）。 */
  private pending: Promise<string | null> | undefined;

  /** 上一次「用户取消」的时间：同一次交互里 owner 会重开 flow，别让选择器跟着再弹一次。 */
  private cancelledAt = 0;

  /** 取消后的抖动窗口（毫秒）：窗口内的重复 `pick` 直接按取消处理。 */
  private static readonly CANCEL_DEBOUNCE_MS = 300;

  /**
   * **稳定的** `pick` 引用：上游 `NativeDirectoryFlow` 的 effect 依赖 `[open, pick]`，
   * 每次渲染换一个新函数会让它在 `open` 抖动时反复触发——真机上表现为刷屏的 `directoryPicker/pick`。
   *
   * 同一次选择也只发一个请求：失败时上游 owner 会把 flow 重新打开（它假定 native 只会「成功/取消」），
   * 没有这层合并就会在失败路径上连发请求。
   */
  private readonly face: NativeFlowFace = {
    pick: () => {
      if (this.pending !== undefined) return this.pending;
      // 取消后 owner 会重开 flow（上游假定 native 只会「成功/取消」，取消也走同一条重开路径）：
      // 这里挡住紧随其后的重复调用，别让系统对话框连弹两次。
      if (Date.now() - this.cancelledAt < DirectoryPickerNativeSlots.CANCEL_DEBOUNCE_MS) {
        return Promise.resolve(null);
      }
      const attempt = this.uiWorkspace
        .pickDirectory()
        .then((path) => {
          if (path === null) this.cancelledAt = Date.now();
          return path;
        })
        .finally(() => {
          if (this.pending === attempt) this.pending = undefined;
        });
      this.pending = attempt;
      return attempt;
    },
  };

  onInit(): void {
    // `WorkspaceBrowser` 的加号按钮看 `sidebar.workspaces.directoryFlow` 的占用数。
    this.disposers.push(
      this.slots.inject("sidebar.workspaces.directoryFlow", () =>
        this.slots.register(
          { name: "sidebar.workspaces.directoryFlow", inject: () => this.face },
          NativeDirectoryFlow,
        ),
      ),
    );
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
