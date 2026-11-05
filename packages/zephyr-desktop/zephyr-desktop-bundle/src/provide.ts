// 桌面插件的装配清单：**一行就够**（面内多行都在里面），装配面只写
// `plugins: [...provideDesktopBundle()]`。
import { provide } from "@morlay/zephyr";
import { BundleCommand } from "./commands/bundle.ts";
import { DesktopCommand } from "./commands/desktop.ts";
import { DesktopDevCommand } from "./commands/dev.ts";
import { PackagerDefault } from "./packager.ts";

/** 桌面形态的清单。 */
export const provideDesktopBundle = provide([
  DesktopCommand,
  DesktopDevCommand,
  BundleCommand,
  PackagerDefault,
]);
