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

  it("发送者校验用传入的 scheme，而不是写死的 dsh-app", () => {
    const scheme = desktopScheme("dsh-custom-next");
    expect(() => assertDesktopSender(sender(`${scheme}://app/`), scheme, ["app"])).not.toThrow();
    expect(() => assertDesktopSender(sender("dsh-app://app/"), scheme, ["app"])).toThrow(
      /unowned renderer/u,
    );
    expect(() => assertDesktopSender(sender(`${scheme}://other/`), scheme, ["app"])).toThrow(
      /unowned renderer/u,
    );
  });

  it("preload 读 scheme 的参数名与主进程注入的一致", () => {
    expect(DESKTOP_SCHEME_ARGUMENT).toBe("--dsh-desktop-scheme");
  });
});
