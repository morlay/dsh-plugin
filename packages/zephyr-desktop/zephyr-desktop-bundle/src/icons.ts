// 应用图标：把 `desktop.icon`（svg/png）转成 electron-builder 认的三平台图标。
//
// 三平台的口径：
// - **macOS**：`icon.icns`——先用 sharp 生成 `icon.iconset/` 的 10 个尺寸，再交给系统的 `iconutil` 打包；
// - **Windows / Linux**：512 的 png（electron-builder 会自己从 png 转 ico）。
//
// 生成物落在产物根的 `icon/`（可重建），配置里显式给 `mac/win/linux.icon`——不给的话 electron-builder 会去
// 项目根扫 `icon.*`，闭包里那份应用自己的 svg 会被当成图标并解析失败。
import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { CliError } from "@morlay/zephyr-cli";

/** 三平台图标的路径（缺的就是没生成）。 */
export interface PreparedIcons {
  readonly mac?: string;
  readonly linux?: string;
  readonly win?: string;
}

/** macOS iconset 的尺寸与文件名（`iconutil` 只认这套命名）。 */
const MAC_ICONSET_SIZES: readonly (readonly [number, string])[] = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];

/** 等比缩放的透明底（图标不能有白边）。 */
const CONTAIN_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 0 } as const;

/**
 * 生成三平台图标。
 * @param options - 工作区、产物根与 `desktop.icon` 的相对路径。
 * @returns 各平台图标的绝对路径（没配图标就是空对象）。
 * @throws CliError 图标文件不存在。
 */
export async function prepareIcons(options: {
  readonly workspace: string;
  readonly outRoot: string;
  readonly icon: string | undefined;
}): Promise<PreparedIcons> {
  if (options.icon === undefined || options.icon === "") return {};
  const source = resolve(options.workspace, options.icon);
  if (!(await exists(source))) {
    throw new CliError(`配置里的 desktop.icon 指向的文件不存在：${source}`);
  }
  const outDir = join(options.outRoot, "icon");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const png512 = join(outDir, "icon-512.png");
  await sharp(source)
    .resize(512, 512, { fit: "contain", background: CONTAIN_BACKGROUND })
    .png()
    .toFile(png512);
  let icons: PreparedIcons = { linux: png512, win: png512 };

  // `icon.icns` 只有 macOS 能产（`iconutil` 是系统命令）；其它平台上打 mac 包本来也不是这里的活。
  if (process.platform === "darwin") {
    const iconset = join(outDir, "icon.iconset");
    await mkdir(iconset, { recursive: true });
    for (const [size, name] of MAC_ICONSET_SIZES) {
      await sharp(source)
        .resize(size, size, { fit: "contain", background: CONTAIN_BACKGROUND })
        .png()
        .toFile(join(iconset, name));
    }
    const icns = join(outDir, "icon.icns");
    await promisify(execFile)("iconutil", ["-c", "icns", iconset, "-o", icns]);
    icons = { ...icons, mac: icns };
  }
  return icons;
}

/**
 * 文件在不在。
 * @param path - 绝对路径。
 * @returns 判断结果。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
