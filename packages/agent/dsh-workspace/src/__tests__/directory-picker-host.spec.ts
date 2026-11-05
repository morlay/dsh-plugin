// host 侧目录选择面（mock client）：`directoryPicker/*` 真的转发到 backend。
//
// backend 用假的 `native` 实现（真的会打开系统对话框）：这里守的是「wire 动词 → capability」的转发，
// 以及 native 不服务的动词会被上游 controller 按能力拒绝（而不是被我们偷偷隐藏）。
import type { DirectoryPickerCapability } from "@deepseek-ai/dsh-host-directory-picker";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault } from "@morlay/zephyr-app";
import { DirectoryPickerBackend } from "@morlay/dsh-workspace";
import { afterEach, describe, expect, it } from "vitest";
import { DirectoryPickerControllerRow } from "../server/directory-picker.host.ts";

@Injectable()
class FakeNativePicker extends DirectoryPickerBackend {
  readonly picks: AbortSignal[] = [];

  /** 下一次 pick 的返回值（`null` = 用户关掉对话框）。 */
  result: string | null = "/tmp/picked";

  capability(): DirectoryPickerCapability {
    return {
      kind: "native",
      pick: async (signal: AbortSignal): Promise<string | null> => {
        this.picks.push(signal);
        return this.result;
      },
    };
  }
}

const opened: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
}, 10_000);

async function boot(): Promise<{ handlers: RemoteHandlers; picker: FakeNativePicker }> {
  const app = await bootstrapApplication({
    providers: [RemoteHandlersDefault, FakeNativePicker, DirectoryPickerControllerRow],
    timeoutMs: 10_000,
  });
  opened.push(app);
  // 按**契约**取（`app.get` 认令牌）：替身的令牌是它继承的 `DirectoryPickerBackend`。
  return {
    handlers: app.get(RemoteHandlers),
    picker: app.get(DirectoryPickerBackend) as FakeNativePicker,
  };
}

describe("host 侧 directoryPicker 面", { timeout: 15_000 }, () => {
  it("directoryPicker/pick 转发到 native capability，返回裸值（与上游 `@Remote` 同协议）", async () => {
    const { handlers, picker } = await boot();
    await expect(handlers.invoke("directoryPicker/pick", {})).resolves.toBe("/tmp/picked");
    expect(picker.picks).toHaveLength(1);
  });

  it("取消选择（null）也是成功（裸值 null，与上游 `@Remote` 同协议）", async () => {
    const { handlers, picker } = await boot();
    picker.result = null;
    await expect(handlers.invoke("directoryPicker/pick", {})).resolves.toBeNull();
  });

  it("native 不服务的动词**抛**结构化的 `directory-picker/unavailable`（不再是 `{ ok: false }`）", async () => {
    const { handlers } = await boot();
    // 裸值协议下失败是**异常**（上游 `@Remote` 的语义），错误对象上带结构化 `code`。
    await expect(handlers.invoke("directoryPicker/list", { path: "/tmp" })).rejects.toMatchObject({
      code: "directory-picker/unavailable",
    });
  });
});
