# @morlay/dsh-desktop-shell

dsh 桌面应用的 **Electron 壳**：服务应用自己的 `<name>://` 协议，经字节管道（FD 3/4）把 desktop profile 交给 host 子进程 [`@morlay/dsh-desktop-host`](../dsh-desktop-host/README.md) 启动，并在首次启动 / 种子指纹变化时把 profile 种进 `DSH_HOME`。

## 用法

它**不单独跑**——启动与打包它的是 [`@morlay/dsh-desktopify`](../dsh-desktopify/README.md)：

- `dsh-desktopify dev` 以**本包目录**为 Electron app 启动（Electron 按本包清单的 `main` 找到 `dist/index.mjs`）；
- `dsh-desktopify bundle` 把本包的 `dist/` 复制成最小壳 app 目录再交给 electron-builder。

出口面、依赖边界与拆分理由见[设计 壳独立成包](./.agents/designs/20260924-壳独立成包.md)；传输、启动链与平台标记见[设计 桌面无端口传输与窗口对齐](../dsh-desktopify/.agents/designs/20260920-桌面无端口传输与窗口对齐.md)。
