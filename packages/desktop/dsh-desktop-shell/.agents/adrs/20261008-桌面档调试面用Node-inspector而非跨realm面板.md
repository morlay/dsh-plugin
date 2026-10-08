# 桌面档调试面用 Node inspector 而非跨 realm 面板

状态：已采纳

背景：上游 `@deepseek-ai/dsh-experimental-inspector` 的调试面是「跨 realm CDP hub + 页内底部面板」：
面板是 iframe，从应用 origin 按相对路径加载镜像的 DevTools 前端（`packages/experimental/inspector/src/client/bottom/page.tsx:60`），
iframe 内的 bootstrap 按 `location` 算出 WebSocket 端点（`assets/devtools/connect.js:6-10`），DevTools 前端再把
`ws` 参数拼成 `ws://<参数>`（`lib/devtools/chunks/legacy-CGqoaXQ2.js:23994`）。

桌面档的页面 origin 是自定义协议 `<scheme>://app`（[桌面无端口传输与窗口对齐](../../../dsh-desktopify/.agents/designs/20260920-桌面无端口传输与窗口对齐.md)），
于是端点被算成 `ws://app/inspector/devtools/cdp`：`app` 不是可解析主机，而 Electron 至今不支持自定义协议上的
WebSocket（[electron#43522](https://github.com/electron/electron/issues/43522) 仍 open）。就算端点写对，桌面主传输也只有
fetch（[index.ts:329](../../src/index.ts#L329) → 无端口 `webServer.dispatch`），`registerUpgrade` 那张表
（[webserver.ts:241](../../../dsh-desktop-host/src/webserver.ts#L241)）在桌面档没有消费者——**面板在桌面档必然空白**。

而「看后端」这件事本来有更短的路：host 是普通 node 进程（打包档也是随包 node 二进制，`--inspect` 与
`node:inspector` 都可用），Node inspector 监听的是**真实回环端口**，DevTools 前端直连它不需要任何新通道。

**决定**

桌面档的调试面由壳提供，两项：

1. **页面**用 Electron 自带 DevTools（`webContents.openDevTools`，dev 形态原本就默认开着）；
2. **后端**用 host 运行时 `node:inspector` 的 `open(0, '127.0.0.1')`（随机端口），壳拿 `inspector.url()` 在一个独立窗口里
   加载 DevTools 前端（产物取自上游那份镜像，由我们自己的 host 托管在应用 origin 的 `/node-devtools` 前缀上），
   URL 显式带 `ws=<host:port>/<uuid>`（上游 README 把 `ws` 查询参数列为自动端点的正式覆盖入口）。

两项都挂在壳的应用菜单上，运行时开关，不需要重启 host。

**考虑过的选项**

- **给面板做回环 WS 隧道**（壳监听端口 + 经 IPC 传 socket handle 转 `registerUpgrade`）：能保住面板语义（`clientSourceId`
  过滤、跨 realm 控制台、Cordis 树、Host fetch 采集），但要在桌面档重新引入一个回环监听面，再加一条 IPC 通道，
  还要解决「面板拿不到真实端点」（只能 302 覆盖 `ws` 参数或 preload 覆写 `WebSocket`，都是改上游产物的行为）→ 否，
  诉求是「看后端」，不值得为此开新面。
- **iframe 整页重定向到隧道 origin**：跨源后 `frame.contentDocument` 为 null，面板绑父窗口的快捷键转发静默失效
  （`src/client/bottom/keyboard.ts:18-20`）→ 否。
- **面板直连 Worker 的 CDP 端点**：少一层转发，但要耦合 Worker 的 targetId 内部实现，且丢掉按 `clientSourceId`
  的过滤 → 否。
- **只开端口，把 `devtools://…` 交给外部 Chrome**：要装浏览器 + 手工粘贴地址，桌面应用内看不到 → 否。
- **把面板的 `ws` 参数覆盖成 Node inspector 端点**：面板只显示 Host 那一路，跨 realm 的东西一样没有，却仍要改
  子框架文档的 URL → 否，直接开一个自己的 DevTools 窗口更直白。

**后果**

- 得到：桌面档能看 host（Sources / Console / Profiler / heap）与页面（Electron 自带 DevTools），且**不新增常驻监听面**
  ——Node inspector 的端口是 host 自己开的、随机、仅回环、随手可关。
- 放弃：跨 realm 合成视图（Host + 每个页面 client 一个连接）、Cordis 树快照、Host fetch 采集——这些是上游 hub 独有的。
- 前端产物仍取自上游 `@deepseek-ai/dsh-experimental-inspector` 的 `lib/devtools`（那个包在 dsh 的依赖闭包里），但
  **由我们自己的 host 托管**在应用 origin 的 `/node-devtools` 前缀上：不必装 `inspector-profile`，因此也不会挂上那个
  在桌面档连不上的底栏面板与它的 Worker（面板的归属见上游 README「已知限制」）。产物不在闭包里时该前缀回 404，
  壳的窗口会显示 not found。
- `--inspect` 那条已有的启动参数路径（`DSH_DESKTOP_HOST_INSPECT_PORT`，仅 dev）与运行时命令共用同一个 Node inspector：
  已经开着端点时（dev 的 `--inspect=127.0.0.1:9231`）命令**复用它**，不会把端口换成新的；取消勾选会真关掉它，重开应用才回来。
  该默认端口由 9230 挪到 9231——9230 是上游 inspector Worker 的默认端口，撞上会让那条行整条回滚（静态托管一起没）。
- 验证：wire 的命令/事件校验、host 侧开关（真开一个回环端点再关）、前端产物托管（命中、产物缺失回 404、越界路径与
  非 GET 拒绝）、壳侧的 DevTools URL 拼接都有单测。
  真机形态（菜单项与那个窗口）在本环境验不了——Electron 在这里因沙箱与 GPU 进程限制直接退出
  （`sandbox initialization failed: Operation not permitted` → `GPU process isn't usable. Goodbye.`，与
  [如何验证](../../../dsh-desktopify/.agents/standards/how-to-verify.md) 记的受限环境同一现象），只验证到准备物：
  壳产物构建通过、菜单模板与 `Menu.getApplicationMenu()` 为 null 时的自建兜底就位。
