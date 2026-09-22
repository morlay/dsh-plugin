# 如何验证（纯 node 面与未覆盖面）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的落点与未覆盖清单。

## 按接缝测（纯 node）

`src/__tests__/` 覆盖命令面、协议编解码、配置 / 路径推导、种子与壳工程产物：

- **协议 / 宿主**：`host-process.spec.ts`（本包），协议常量与编解码在宿主包
  （`packages/desktop/dsh-desktop-host/src/__tests__/wire.spec.ts`）；
- **命令面与配置**：`cli-surface.spec.ts`、`workspace-config.spec.ts`、`appconfig.spec.ts`、
  `ipc.spec.ts`（app 名 → scheme 的派生与发送者校验）、`dshhome.spec.ts`、`shell-env.spec.ts`、
  `shell-import-boundary.spec.ts`（壳产物的依赖边界：壳可达模块不得裸引用 asar 里解析不到的包），
  `shell-app-directory.spec.ts`、`dev-*.spec.ts`；
- **种子 / 部署 / 运行时闭包**：`seed-*.spec.ts`、`profile-seed.spec.ts`、`deploy-*.spec.ts`、
  `official-*.spec.ts`、`runtime-packages.spec.ts`、`prepare-runtime-target.spec.ts`、
  `agent-presets.spec.ts`；
- **profile 项目与安装**：`profile-project.spec.ts` 用注入的 spawn 断言安装命令行与失败诊断（不真跑 pnpm），
  并覆盖 `overrides` 的写入 / 替换 / 空列表保留手写内容。

宿主包（`packages/desktop/dsh-desktop-host/src/__tests__/`）的流面也按接缝测：`wire.spec.ts`（管道编解码，
以及桌面流请求体的按行编解码——跨块与多字节切分、末行无换行、非法 JSON）、`webserver.spec.ts`（无端口替身的
路由与派发）、`transport.spec.ts`（认证接管、`/.dsh/remote-stream` 路由与上游 0.1.7 的五参
`wireStream.open` 契约：上行项按序进 uplink、peer 是 operator，以及注入脚本 `openStream` 的上行转发与取消
语义——signal abort 后迭代必须立即结束、且不再上行，见
[设计 后续变化（2026-09-22）](../designs/20260920-桌面无端口传输与窗口对齐.md#后续变化2026-09-22)）。
`stream-uplink.spec.ts`（本包）覆盖页面侧的排队纯逻辑：`open` 的 IPC 往返回来之前先排队、绑定后按序发。

## 未覆盖（有明确原因）

- **Electron 主进程 / preload / `cli/{bundle,dev}.ts` 私有逻辑**：导入即触发 `app.whenReady()` 等
  副作用，需要整套 Electron mock 面——真实启动见该包[设计 桌面化工具](../designs/20260917-桌面化工具.md)
  与其中链接的打包器 ADR。preload 里能拿出来的纯逻辑（流的上行排队，`stream-uplink.spec.ts`）已单测，
  留在 `preload-app.ts` 里的只剩 IPC 接线。
- **Windows 目标的运行时载荷分支**：`prepare-runtime` 的 Windows 分支（zip 解包、复制 `node.exe`、
  `bin/` 复制而非符号链接）需要造 zip fixture，本机（unix）跑不到，测试里以
  `it.skipIf(process.platform === "win32")` 明示；跨平台打包本身被显式拒绝（见设计文档「随包运行时载荷」）。
