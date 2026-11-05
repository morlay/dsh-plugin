// `@morlay/zephyr-desktop-bundle` 的公开面：一个 provide 函数 + 可单独引用的契约与推导。
export { provideDesktopBundle } from "./provide.ts";
export { electronBuilderConfigOf, type ElectronBuilderConfig } from "./electron-builder.ts";
export { Packager, PackagerDefault, type PackResult } from "./packager.ts";
export { BundleCommand } from "./commands/bundle.ts";
export { DesktopCommand } from "./commands/desktop.ts";
export { DesktopDevCommand } from "./commands/dev.ts";
