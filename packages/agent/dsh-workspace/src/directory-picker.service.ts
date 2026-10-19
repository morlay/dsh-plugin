// 目录选择 backend（host 半）：上游 `directory-picker-native` 的 `native` 能力。
//
// 与上游默认一致：本机部署用操作系统对话框（macOS 的 AppKit panel / Linux 的 zenity / Windows 的 IFileOpenDialog）。
// `browse` 那套（应用内浏览）是给「远程客户端看不到宿主屏幕」的部署用的；这里的页面就开在宿主上。
import NativeDirectoryPicker from "@deepseek-ai/dsh-host-directory-picker-native";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { DirectoryPickerBackend } from "./contract/directory-picker.contract.ts";

@Injectable()
export class DirectoryPickerNative extends fromCordis(DirectoryPickerBackend, NativeDirectoryPicker) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
