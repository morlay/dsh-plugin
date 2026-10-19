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
import { DirectoryPickerControllerRow } from "../directory-picker.host.ts";

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
  return { handlers: app.get(RemoteHandlers), picker: app.get(FakeNativePicker) };
}

describe("host 侧 directoryPicker 面", { timeout: 15_000 }, () => {
  it("directoryPicker/pick 转发到 native capability，结果包成 RemoteResult", async () => {
    const { handlers, picker } = await boot();
    await expect(handlers.invoke("directoryPicker/pick", {})).resolves.toEqual({
      ok: true,
      value: "/tmp/picked",
    });
    expect(picker.picks).toHaveLength(1);
  });

  it("取消选择（null）也是成功：{ ok: true, value: null }（客户端按 result.ok 解）", async () => {
    const { handlers, picker } = await boot();
    picker.result = null;
    await expect(handlers.invoke("directoryPicker/pick", {})).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("native 不服务的动词回 { ok: false }（list → directory-picker/unavailable）", async () => {
    const { handlers } = await boot();
    const result = (await handlers.invoke("directoryPicker/list", { path: "/tmp" })) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("directory-picker/unavailable");
    expect(result.error?.message).toMatch(/needs the browse capability/u);
  });
});
