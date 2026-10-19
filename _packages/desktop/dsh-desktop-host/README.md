# @morlay/dsh-desktop-host

桌面部署里那个 **host 进程**：按 `desktop` profile 把 Web 应用启起来，然后**在进程内接管 `webServer`**——不监听任何端口，Electron 壳把该应用自己的协议（`<app name>://app/*`）的请求经字节管道（FD 3/4）喂进来。

上游 `apps/desktop-host`（`@deepseek-ai/dsh-desktop-host`）是 `private: true` 的应用，外部装不到，所以这里是它的**变体包**：IPC 契约照旧，argv 与本仓库的 web 入口统一成一套 flag（见下）。

## 用法

被 [`@local/dshdev`](../../../devpackages/dshdev/README.md) 使用，不单独跑：

- `dev` / `bundle` 把本包落位到部署的 `<runtime>/node_modules/@morlay/dsh-desktop-host`（`dev` 从工作区解析同一份包，`bundle` 按 manifest `files` 复制），三样必须都在——`src/index.ts`（启动入口，壳按 node 解析取**源码**，由 TS loader 转译）、当时那个无端口替身（已删）（桌面 patch 行按 当时那个无端口替身（已删） 加载）、`config/desktop.cordis.patch.yml`（入口按它作 `patchFiles` 读）；
- 壳启动它（stdio：stdout/stderr 落盘 + FD 5 是 Node IPC），argv 与 web 入口**同一套**
  （解析只有一处，见 [`src/invocation.ts`](./src/invocation.ts)）：

  ```
  <entry> --profile-dir <dir> --runtime-dir <dir> [--patch <file>]… [--pnpm <path> --node-bin <dir>] [-- <内层参数>]
  ```

  `--profile-dir` 是 profile root（打包形态是种子种出的 `$DSH_HOME/profiles/<name>`，dev 形态是 app 目录本身）；

- **入口只做三件事**：[`src/index.ts`](./src/index.ts) 解析参数 → 装配 → 接线；装配在
  [`@morlay/dsh-app-boot`](../../boot/dsh-app-boot/README.md)（desktop 与 web 共用，层完全由 profile 的
  `dsh.profile.bundles` 决定），管道与请求分发在 [`src/desktop-ipc.ts`](./src/desktop-ipc.ts)，传输接管在
  [`src/transport.ts`](./src/transport.ts)；
- `--web`（dev 的 web 形态）走 [`src/web.ts`](./src/web.ts)：同一个 `bootAppProfile`，只是 profile 名换成
  `web` 并多一个端口契约，见[设计 dev 形态的 profile root 就是 app 目录](../../../devpackages/dshdev/.agents/designs/20261014-数据与工作目录的-layout.md)；
- IPC：`ready { protocolVersion, wsPort }` / `fatal { message, diagnostic }`，另外收 `shutdown`。

运行时做的事（profile 装配、`webServer` 替身、认证接管、客户端 transport 与账号面）、出口面与依赖边界见[设计 桌面host的运行时面与依赖边界](./.agents/designs/20260929-桌面host的运行时面与依赖边界.md)；载波形态的取舍见[设计 桌面运行形态与窗口对齐](.agents/designs/20260920-桌面运行形态与窗口对齐.md)。
