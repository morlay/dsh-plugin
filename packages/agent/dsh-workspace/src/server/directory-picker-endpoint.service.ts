// `directoryPicker` 组的**宿主实现**：继承 `endpoint/` 的契约类，转发到上游 controller。
//
// 组名与方法名都来自契约（`@RemoteGroup` / `@RemoteMethod`），这里只写业务转发：
// 三个动词全注册（`native` backend 只服务 `pick`，`list` / `createDirectory` 由上游 controller 按
// capability 拒绝 `directory-picker/unavailable`——不近似、不隐藏），应答是**裸值**
// （客户端的 `remote.<组>` 面按 `result.ok` 解；「取消选择」是 `null`，也是成功）。
import type { DirectoryListing } from "@deepseek-ai/dsh-api-workspace-controller/types";
import { inject, Injectable, type OnDispose } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { DirectoryPickerEndpoint } from "../endpoint/index.ts";
import {
  DirectoryPickerControllerRow,
  isDirectoryPickerHostFace,
} from "./directory-picker.host.ts";

/** `directoryPicker` 组的宿主实现。 */
@RemoteGroup()
@Injectable()
export class DirectoryPickerEndpointRow extends DirectoryPickerEndpoint implements OnDispose {
  private readonly handlers = inject(RemoteHandlers);

  /** 上游 controller 的适配行发布的就是 `DirectoryPickerController`（那三个动词）。 */
  private readonly controller = inject(DirectoryPickerControllerRow);

  private readonly disposers: (() => void)[] = [];

  onInit(): void {
    // 装配期就报「上游 controller 与 wire 面不同步」，而不是等第一次请求炸成
    // `this.controller.list is not a function`。
    if (!isDirectoryPickerHostFace(this.controller)) {
      throw new Error(
        "directoryPicker: 上游 DirectoryPickerController 实例缺少 list / pick / createDirectory" +
          "（wire 面与上游 controller 不同步）",
      );
    }
    this.disposers.push(registerRemoteGroup(this.handlers, this));
  }

  override async list(path: string | undefined): Promise<DirectoryListing> {
    // unary 的 wire 不带信号；上游 `list` 要一个（它按 `signal.aborted` 区分「取消」与「失败」），
    // 给一个不会 abort 的 controller——与下面 `pick` 同一口径。
    return await this.controller.list(path, new AbortController().signal);
  }

  override async createDirectory(path: string, name: string): Promise<string> {
    return await this.controller.createDirectory(path, name);
  }

  override async pick(): Promise<string | null> {
    // unary 的 wire 不带信号；上游 `pick` 签名要一个 `AbortSignal`。
    return await this.controller.pick(new AbortController().signal);
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
