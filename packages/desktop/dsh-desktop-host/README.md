# @morlay/dsh-desktop-host

桌面部署里那个 **host 进程**：按 `desktop` profile 把 Web 应用启起来，然后**在进程内接管 `webServer`**——不监听任何端口，Electron 壳把该应用自己的协议（`<app name>://app/*`）的请求经字节管道（FD 3/4）喂进来。

上游 `apps/desktop-host`（`@deepseek-ai/dsh-desktop-host`）是 `private: true` 的应用，外部装不到，所以这里是它的**变体包**：argv / IPC 契约、`lib/index.js` 入口路径照旧。

## 用法

被 [`@morlay/dsh-desktopify`](../dsh-desktopify/README.md) 使用，不单独跑：

- `dev` / `bundle` 把本包落位到部署的 `<runtime>/node_modules/@morlay/dsh-desktop-host`（`dev` 从工作区解析同一份包，`bundle` 按 manifest `files` 复制），四样必须都在——`lib/index.js`（启动入口）、`lib/webserver.js`（桌面 patch 行按 `../lib/webserver.js` 加载）、`lib/wire.js`、`config/desktop.cordis.patch.yml`（入口按它作 `patchFiles` 读）；
- 壳按 `lib/index.js` 启动它（stdio 五元组：FD 3/4 是管道，FD 5 是 Node IPC），argv 为 `[entry, runtimeDir, profileDir, pnpmEntry?, nodeBin?]`——`profileDir` 是 profile root（打包形态是种子种出的 `$DSH_HOME/profiles/<name>`，dev 形态是 app 目录本身），装配是官方那两步（`loadProfileDirectory` + `runProfile`）；
- `src/app-boot.ts` 与 `src/web.ts` 只服务 dev 形态的 `--web`（不进包的 `files`）：上游 `dsh web` 按 profile 名找 profile，与「dev 的 profile root 是 app 目录」冲突，所以那里有 dev 自己的入口，见[设计 dev 形态的 profile root 就是 app 目录](../dsh-desktopify/.agents/designs/20261010-app目录即profile-root.md)；
- IPC：`ready { protocolVersion }` / `fatal { message, diagnostic }`，另外收 `shutdown`。

运行时做的事（profile 装配、`webServer` 替身、认证接管、客户端 transport 与账号面）、出口面与依赖边界见[设计 桌面host的运行时面与依赖边界](./.agents/designs/20260929-桌面host的运行时面与依赖边界.md)；载波形态的取舍见[设计 桌面无端口传输与窗口对齐](../dsh-desktopify/.agents/designs/20260920-桌面无端口传输与窗口对齐.md)。
