import { describe, expect, it } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { DESKTOP_SCHEME_ARGUMENT, assertDesktopSender, desktopScheme } from "../ipc.ts";

function sender(url: string): IpcMainInvokeEvent {
  return { senderFrame: { url } } as unknown as IpcMainInvokeEvent;
}

describe("桌面标识取自 app 名", () => {
  it("直接用包名（与官方桌面的 dsh-app 错开）", () => {
    expect(desktopScheme("dsh-custom-next")).toBe("dsh-custom-next");
  });

  it("去 scope 前缀、转小写、非法字符换成 '-'", () => {
    expect(desktopScheme("@morlay/dsh_custom")).toBe("dsh-custom");
    expect(desktopScheme("@morlay/Dsh.Custom+next")).toBe("dsh.custom+next");
  });

  it("派生不出合法 scheme 时报错", () => {
    for (const name of ["", "@morlay/", "1app", "_app"]) {
      expect(() => desktopScheme(name)).toThrow(/does not yield a usable URL scheme/u);
    }
  });

  it("发送者校验比的是页面 origin（页面从宿主 origin 载入，不是自定义协议）", () => {
    const origin = "http://127.0.0.1:51234";
    expect(() => assertDesktopSender(sender(`${origin}/?token=x`), [origin])).not.toThrow();
    // 自定义协议那条老路：页面早已不从它载入，不能再被当成本应用。
    expect(() => assertDesktopSender(sender("dsh-custom-next://app/"), [origin])).toThrow(
      /unowned renderer/u,
    );
    // 别的 origin（另一个本地端口、外部站点）同样拒绝。
    expect(() => assertDesktopSender(sender("http://127.0.0.1:59999/"), [origin])).toThrow(
      /unowned renderer/u,
    );
    expect(() => assertDesktopSender(sender("https://example.com/"), [origin])).toThrow(
      /unowned renderer/u,
    );
  });

  it("preload 读 scheme 的参数名与主进程注入的一致", () => {
    expect(DESKTOP_SCHEME_ARGUMENT).toBe("--dsh-desktop-scheme");
  });
});
