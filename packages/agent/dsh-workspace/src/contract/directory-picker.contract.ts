// 目录选择 backend 契约（host 半）：上游 `DirectoryPicker` 的 backend 能力面。
//
// host 能力一个令牌，真实现由上游 backend 适配（`DirectoryPickerNative`），装配/测试可以换成假实现。
// 上游 `DirectoryPickerController` 通过 `ctx.directoryPicker.capability()` 调它。
import type { DirectoryPickerCapability } from "@deepseek-ai/dsh-host-directory-picker";
import type NativeDirectoryPicker from "@deepseek-ai/dsh-host-directory-picker-native";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

/**
 * 契约面：上游 `NativeDirectoryPicker` 的全部公开成员。
 *
 * 覆盖守卫在编译期核对，漏一个就报出成员名；令牌上的方法是手写形态（假件按方法实现），
 * 不用 `Pick` 的属性形态。
 */
type DirectoryPickerBackendFace = Pick<NativeDirectoryPicker, "capability">;

/**
 * 覆盖守卫：`DirectoryPickerBackendFace` 的 `Pick` 就是上游**全量**（上游 backend 只有 `capability` 一个公开成员）。
 *
 * 为什么不是 `implements NativeDirectoryPicker`：上游是 cordis `Service` **类**（带私有成员），`implements`
 * 会报 TS2720。
 */
export type DirectoryPickerBackendCovered = AssertTrue<
  AssertCoveredStrict<NativeDirectoryPicker, DirectoryPickerBackendFace>
>;

@Injectable({ name: "directoryPicker" })
export abstract class DirectoryPickerBackend {
  /** 这个 backend 交互形态（`native` 或 `browse`）。 */
  abstract capability(): DirectoryPickerCapability;
}
