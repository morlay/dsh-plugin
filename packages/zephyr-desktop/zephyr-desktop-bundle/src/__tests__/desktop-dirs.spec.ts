import { describe, expect, it } from "vitest";
import {
  appDataHomeOf,
  appRootOf,
  packagedBootstrap,
  USER_DATA_SUBDIR,
  userDataDirOf,
} from "../desktop-dirs.ts";

const DESKTOP_ID = "ai.deepseek.zephyr.custom";

describe("部署值：appData 目录（与 Electron 同口径）", () => {
  it("macOS / Windows / Linux 三种口径", () => {
    expect(appDataHomeOf({}, "darwin", "/Users/x")).toBe("/Users/x/Library/Application Support");
    expect(appDataHomeOf({ APPDATA: "C:/Users/x/AppData/Roaming" }, "win32", "C:/Users/x")).toBe(
      "C:/Users/x/AppData/Roaming",
    );
    expect(appDataHomeOf({}, "win32", "C:/Users/x")).toBe("C:/Users/x/AppData/Roaming");
    expect(appDataHomeOf({ XDG_CONFIG_HOME: "/home/x/.config2" }, "linux", "/home/x")).toBe(
      "/home/x/.config2",
    );
    expect(appDataHomeOf({}, "linux", "/home/x")).toBe("/home/x/.config");
  });
});

describe("部署值：应用根（可读、不哈希）", () => {
  const appDataHome = "/home/x/.config";

  it("打包 / bundle / preview 是 <appData>/<desktop.id>", () => {
    expect(appRootOf({ appDataHome, desktopId: DESKTOP_ID, form: "packaged" })).toBe(
      `/home/x/.config/${DESKTOP_ID}`,
    );
  });

  it("dev 多一段 dev（同一个应用的两个工作区共用它，并行靠显式值）", () => {
    expect(appRootOf({ appDataHome, desktopId: DESKTOP_ID, form: "dev" })).toBe(
      `/home/x/.config/${DESKTOP_ID}/dev`,
    );
  });

  it("目录名里只有应用 id（不哈希工作区路径、不带工作区名）", () => {
    const root = appRootOf({ appDataHome, desktopId: DESKTOP_ID, form: "dev" });
    expect(root.split("/").at(-1)).toBe("dev");
    expect(root).not.toMatch(/[0-9a-f]{8}/u);
  });
});

describe("部署值：userData", () => {
  it("各形态都是应用根下的 electron/", () => {
    expect(userDataDirOf("/home/x/.config/ai.x/dev")).toBe(
      `/home/x/.config/ai.x/dev/${USER_DATA_SUBDIR}`,
    );
    expect(userDataDirOf("/home/x/.config/ai.x")).toBe(`/home/x/.config/ai.x/${USER_DATA_SUBDIR}`);
  });

  it("不住产物根（runBuild 会整目录删掉 node_modules/.zephyr）", () => {
    const dir = userDataDirOf(
      appRootOf({ appDataHome: "/w/app/.zephyr", desktopId: DESKTOP_ID, form: "dev" }),
    );
    expect(dir.startsWith("/w/app/node_modules")).toBe(false);
  });
});

describe("部署值：打包形态的启动器", () => {
  const source = packagedBootstrap();

  it("显式值优先，缺了才用 <appData>/<desktop.id> 算出来的部署值", () => {
    expect(source).toContain("if (process.env.ZEPHYR_DESKTOP_USER_DATA === undefined)");
    expect(source).toContain('process.env.ZEPHYR_DESKTOP_USER_DATA = join(root, "electron")');
    expect(source).toContain("if (process.env.ZEPHYR_DESKTOP_DATA_DIR === undefined)");
    expect(source).toContain("process.env.ZEPHYR_DESKTOP_DATA_DIR = root");
  });

  it("部署值取自 appData 与应用 id（Resources/desktop.json），最后加载壳的入口", () => {
    expect(source).toContain('app.getPath("appData")');
    expect(source).toContain("desktop.json");
    expect(source).toContain("desktop.id");
    expect(source).toContain('await import("./dist/main.mjs")');
  });
});
