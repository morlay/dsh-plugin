/**
 * `electron` 模块的**唯一入口**（壳自己的其它文件都从这里取）。
 *
 * 壳产物是 **ESM**（`.mjs`，Electron 28+ 支持 ESM 入口），而 `electron` 在 ESM 下**只有默认导出**：具名导入
 * 会抛 `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`，
 * 主进程在 `load` 阶段就没了。更麻烦的是**打包器会把"默认导入 + 解构 / 取属性"优化回具名导入**——那样又回到
 * 同一个错误。
 *
 * 所以这里**走运行期 `require`**：壳就是 Electron 主进程，`require("electron")` 正是它给这个模块的原生形态，
 * 打包器碰不到它。类型仍从 `electron` 取（类型导入会被擦除，不影响运行）。
 */
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron") as typeof import("electron");

export const app = electron.app;
export const BrowserWindow = electron.BrowserWindow;
export const dialog = electron.dialog;
export const ipcMain = electron.ipcMain;
export const nativeTheme = electron.nativeTheme;
export const protocol = electron.protocol;
export const Menu = electron.Menu;
export const MenuItem = electron.MenuItem;

// 类型仍从 `electron` 取：`import type` 会被擦除，不进运行字节；而 `BrowserWindow` / `Menu` 这类
// **既是值又是类型**的名字不能在这里再导一次（同名重复导出 TS 直接报错），用的人自己
// `import type { BrowserWindow } from "electron"`。
export type {
  BrowserWindowConstructorOptions,
  Input,
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
} from "electron";
