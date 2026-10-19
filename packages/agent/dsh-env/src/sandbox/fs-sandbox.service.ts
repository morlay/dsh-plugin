// 文件系统：上游 `SandboxedFileSystem` 经 `fromCordis` 接管。
import SandboxedFileSystem from "@deepseek-ai/dsh-fs-sandbox";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { FileSystem } from "../fs/fs.contract.ts";
import { SandboxPolicy } from "../sandbox-policy.contract.ts";

@Injectable()
export class FsSandbox extends fromCordis(FileSystem, SandboxedFileSystem) {
  sandboxPolicy = inject(SandboxPolicy);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sandboxPolicy: this.sandboxPolicy });
  }
}
