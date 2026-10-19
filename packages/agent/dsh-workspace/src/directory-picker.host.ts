// 宿主侧 `remote.directoryPicker` 的提供者：上游 `DirectoryPickerController` + wire 路由。
//
// 与 `WorkspaceController` 同一模式：上游 `@Remote` 只生成 descriptor，wire 由我们的 `MuxServer` 独占，
// 所以每个动词都要在 `RemoteHandlers` 上显式注册。backend 由 `DirectoryPickerNative` 提供（`ctx.directoryPicker`）。
import { DirectoryPickerController } from "@deepseek-ai/dsh-api-workspace-controller";
import { inject, Injectable, type Context, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { fromCordis } from "@morlay/zephyr/compat";
import { DirectoryPickerBackend } from "./contract/directory-picker.contract.ts";
import { asRemoteResult } from "@morlay/zephyr-app";

/** 宿主侧要转发的三个动词：形状直接取上游 controller（签名只在一个 home 里）。 */
type DirectoryPickerHostFace = Pick<DirectoryPickerController, "list" | "pick" | "createDirectory">;

/**
 * 上游实例 → 我们要转发的面。
 *
 * `fromCordis` 的 `providerInstance` 声明成 `object | undefined`（上游实例类型没带出来），所以这里按
 * **运行时**校验三个动词都是函数再收窄——装配期就报「上游 controller 与 wire 面不同步」，
 * 而不是等第一次请求时炸成 `host.list is not a function`。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns 三个动词齐备时是真。
 */
function isDirectoryPickerHostFace(value: unknown): value is DirectoryPickerHostFace {
  return (
    value !== null &&
    typeof value === "object" &&
    "list" in value &&
    typeof value.list === "function" &&
    "pick" in value &&
    typeof value.pick === "function" &&
    "createDirectory" in value &&
    typeof value.createDirectory === "function"
  );
}

@Injectable()
export class DirectoryPickerControllerRow extends fromCordis(DirectoryPickerController) implements OnDispose {
  private readonly directoryPicker = inject(DirectoryPickerBackend);

  private readonly handlers = inject(RemoteHandlers);

  private readonly disposers: (() => void)[] = [];

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {}, { directoryPicker: this.directoryPicker });
    const host = this.providerInstance;
    if (host === undefined || !isDirectoryPickerHostFace(host)) {
      throw new Error(
        "directoryPicker: 上游 DirectoryPickerController 实例缺少 list / pick / createDirectory" +
          "（wire 面与上游 controller 不同步）",
      );
    }
    // 三个动词都注册：`native` backend 只服务 `pick`，`list` / `createDirectory` 由上游 controller
    // 按 capability 拒绝（`directory-picker/unavailable`）——不近似、不隐藏。
    // wire 参数名按 descriptor：`list` 收 `path`，`createDirectory` 收 `path` + `name`。
    // 结果按上游 wire 包成 `RemoteResult`：客户端的生成面（`uiWorkspace.pickDirectory`）按 `result.ok` 解。
    // 「取消选择」也是**成功**（`{ ok: true, value: null }`），不是失败。
    this.disposers.push(
      this.handlers.register("directoryPicker/list", async (args) => {
        const path = args.path;
        // unary 的 wire 不带信号；上游 `list` 要一个（它按 `signal.aborted` 区分「取消」与「失败」），
        // 给一个不会 abort 的 controller——与下面 `pick` 同一口径。
        return await asRemoteResult(() =>
          host.list(typeof path === "string" ? path : undefined, new AbortController().signal),
        );
      }),
      this.handlers.register("directoryPicker/createDirectory", async (args) =>
        asRemoteResult(() => host.createDirectory(String(args.path), String(args.name))),
      ),
      // unary 的 wire 不带信号；上游 `pick` 签名要一个 `AbortSignal`。
      this.handlers.register("directoryPicker/pick", async () =>
        asRemoteResult(() => host.pick(new AbortController().signal)),
      ),
    );
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
