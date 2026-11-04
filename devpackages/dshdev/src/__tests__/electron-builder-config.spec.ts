import { join } from "node:path";
import type { AppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import { describe, expect, it } from "vitest";
import { desktopBuildConfig } from "../cli/electron-builder.ts";

function appConfig(): AppConfig {
  return {
    name: "dsh-custom-next",
    displayName: "DSH Custom Next",
    id: "ai.deepseek.dsh.custom-next",
    version: "0.2.0",
    profile: "desktop",
    dataDir: "xdg",
    window: { width: 1280, height: 800, minWidth: 800, minHeight: 600 },
  };
}

describe("desktopBuildConfig", () => {
  // 对外名字取显示名（mac 的 `.app`、Windows 的 exe、artifact 名都跟着它）；Linux 的可执行名由
  // electron-builder 取壳 app 目录 `package.json` 的 `name`，与安装脚本拼的 `Exec` 必须同一个——
  // 所以它显式钉在工作区包名上，不跟着显示名走。
  it("names the product after the display name and pins the Linux executable to the package name", () => {
    const config = desktopBuildConfig({
      appConfig: appConfig(),
      icons: {},
      electron: { version: "44.3.0" },
      buildCache: "/build",
    });

    expect(config.appId).toBe("ai.deepseek.dsh.custom-next");
    expect(config.productName).toBe("DSH Custom Next");
    expect(config.artifactName).toBe("${productName}-${version}-${os}-${arch}.${ext}");
    expect(config.linux?.executableName).toBe("dsh-custom-next");
    expect(config.electronVersion).toBe("44.3.0");
    expect(config.directories?.output).toBe(join("/build", "artifacts"));
    // **开 asar**：宿主跑的是 Electron 的 node（`ELECTRON_RUN_AS_NODE`），asar 补丁对它照样生效，
    // 于是整棵依赖树能留在归档里、只有 native 拆出来。判据见
    // `../.agents/designs/20261016-随包布局：app 进 asar、宿主依赖住 runtime.md`。
    expect(config.asar).toBe(true);
    expect(config.asarUnpack).toEqual(["**/*.node"]);
    expect(config.files).toEqual([
      "main.mjs",
      "package.json",
      "src/**",
      // 构建期打好的 preload（运行时只读它：打包器是 native，读不了 asar 内的源码）。
      "dist/**",
      "locale/*.json",
    ]);
    expect(config.mac?.target).toEqual(["dir"]);
    expect(config.linux?.target).toEqual(["dir"]);
    expect(config.win?.target).toEqual(["dir"]);
  });

  it("passes a prepared icon through to its platform and the extra resources through to resources", () => {
    const config = desktopBuildConfig({
      appConfig: appConfig(),
      icons: { mac: "/icons/icon.icns", linux: "/icons/icon.png", win: "/icons/icon.ico" },
      electron: { version: "44.3.0", dist: "/electron/dist" },
      buildCache: "/build",
    });

    expect(config.mac?.icon).toBe("/icons/icon.icns");
    expect(config.linux?.icon).toBe("/icons/icon.png");
    expect(config.win?.icon).toBe("/icons/icon.ico");
    expect(config.electronDist).toBe("/electron/dist");
    expect(config.extraResources).toEqual([
      // profile 的解析面（闭包）不在这里：electron-builder 的忽略规则会吞掉 node_modules，
      // 它由 `afterPack` 把 `prepareSeed` 的 deploy 闭包复制到 `Resources/profile`。
      { from: join("/build", "runtime"), to: "runtime" },
      { from: join("/build", "seed"), to: "seed" },
      { from: join("/build", "runtime", "appconfig.json"), to: "appconfig.json" },
    ]);
  });
});
