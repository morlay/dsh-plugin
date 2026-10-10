# 如何验证（纯 node 面与未覆盖面）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包与相邻壳包的落点、以及未覆盖清单。

## 按接缝测（纯 node）

**工具包**（`packages/desktop/dsh-desktopify/src/__tests__/`）：

- **命令面与工作区契约**：`cli-surface.spec.ts`、`workspace-config.spec.ts`、`appconfig.spec.ts`、
  `dev-home.spec.ts`、`dev-web.spec.ts`、`desktop-host.spec.ts`、`shell-app-directory.spec.ts`（给 host 的
  loader specifier 必须是绝对 `file:` 地址——子进程的 cwd 是部署目录，裸名在那儿解析不到）；
- **部署与依赖闭包**：`deploy-spec.spec.ts`、`deploy-settings.spec.ts`、`official-deploy-specs.spec.ts`、
  `official-package-payload.spec.ts`、`missing-official-packages.spec.ts`；
- **种子、指纹与随包载荷**：`profile-seed.spec.ts`、`seed-fingerprint.spec.ts`、`prepare-runtime-target.spec.ts`；
- **dev 客户端 bundle**：`dev-client-combo.spec.ts`、`dev-client-route.spec.ts`。

**壳包**（`packages/desktop/dsh-desktop-shell/src/__tests__/`）持有壳侧的纯 node 面：`ipc.spec.ts`（app 名 →
scheme 的派生与发送者校验）、`dshhome.spec.ts`、`shell-env.spec.ts`、`document-marks.spec.ts`、
`official-packages.spec.ts`、`profile-project.spec.ts`（含 `overrides` 的写入 / 替换 / 空列表保留手写内容）、
`runtime-packages.spec.ts`、`seed-profile.spec.ts`、`host-process.spec.ts`（管道载体与 `--title`）、
`stream-uplink.spec.ts`（页面侧排队纯逻辑：`open` 的 IPC 往返回来之前先排队、绑定后按序发）、
`shell-import-boundary.spec.ts`（壳产物的依赖边界：壳可达模块不得裸引用 asar 里解析不到的包）。

**host 变体包**（`packages/desktop/dsh-desktop-host/src/__tests__/`）的传输面：`wire.spec.ts`（管道编解码，以及
桌面流请求体的按行编解码——跨块与多字节切分、末行无换行、非法 JSON）、`webserver.spec.ts`（无端口替身的路由与
派发）、`transport.spec.ts`（认证接管、`/.dsh/remote-stream` 路由与上游五参 `wireStream.open` 契约：上行项按序进
uplink、peer 是 operator，以及注入脚本 `openStream` 的上行转发与取消语义——signal abort 后迭代必须立即结束、且
不再上行）、`desktop-patch.spec.ts`（桌面 patch 的行集合）、`manifest.spec.ts`（清单与产物互相覆盖）。

## 未覆盖（有明确原因）

- **两种 dev 形态的真机启动**：`dev --web` 用 curl 取 `/plugins/??<包名>/client.js`；桌面形态没有端口，改用壳的
  renderer 调试口（`--remote-debugging-port=9222`，`curl /json/list` 拿页面 target 后在页面里 `fetch` 同一路径）。
  两者都应拿到现场转换的字节（与 `dist/client.cjs` 不同、也不是 `src/client/index.ts` 的原文），且改一处 client
  源码再取一次能看到字节随之变化。无 GUI 的环境（CI / 受限沙箱：`sandbox initialization failed` + GPU 进程退出）
  起不来 Electron，那里退一步只验证准备物：`<projectDir>/cordis.patch.yml` 含 `dev-client-bundles` 行、
  `<projectDir>/node_modules/@morlay/dsh-desktopify` 可达、以 projectDir 为 cwd 能
  `import("@morlay/dsh-desktopify/dev-client-bundles")`（三样齐了那行才会激活）。
- **Electron 主进程 / preload / 工具侧 `cli/{bundle,dev}.ts` 私有逻辑**：导入即触发 `app.whenReady()` 等副作用，
  需要整套 Electron mock 面——真实启动见[设计 桌面化工具](../designs/20260917-桌面化工具.md)与其中链接的打包器
  ADR。preload 里能拿出来的纯逻辑已有单测（壳包的 `stream-uplink.spec.ts`），留在 `preload-app.ts` 里的只剩 IPC
  接线。
- **Windows 目标的运行时载荷分支**：`prepare-runtime` 的 Windows 分支（zip 解包、复制 `node.exe`、`bin/` 复制而非
  符号链接）需要造 zip fixture，本机（unix）跑不到，测试里以 `it.skipIf(process.platform === "win32")` 明示；
  跨平台打包本身被显式拒绝（见[设计 桌面化工具](../designs/20260917-桌面化工具.md)「随包运行时载荷」）。
