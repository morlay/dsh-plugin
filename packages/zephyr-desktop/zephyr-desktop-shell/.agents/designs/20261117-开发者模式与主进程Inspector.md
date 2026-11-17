# 桌面开发者模式与主进程 Inspector

状态：设计已对齐（Q1=A / Q2=A），已实现（`feat(zephyr-desktop-shell): 开发者模式与主进程 Inspector`）。
范围：`packages/zephyr-desktop/zephyr-desktop-shell/src/`（调试面、菜单、窗口），以及它读写的 userData 标记。
非目标：跨 realm 的 CDP inspector（上游 `@deepseek-ai/dsh-experimental-inspector` 那套：Host Worker + 多 realm + Client 只读 Sources）——我们只有一个主进程和一个页面，需要的是「DevTools + 主进程 Node inspector」。
关联：[桌面两包与单进程壳](../designs/20261110-桌面两包与单进程壳.md) · [desktop 功能面](../../zephyr-desktop-bundle/.agents/designs/20261114-desktop功能面.md)

## 一、决定

| #   | 议题           | 决定                                                                                                              | 一句话理由                                                                 |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | 开发者模式     | **可变的运行时状态**（不是只读值）：来源三合一（`ZEPHYR_DESKTOP_DEBUG=1` / `--zephyr-debug` / userData 下的 `debug` 标记），运行期可切，切换即写标记 | Finder 双击启动没有环境变量也没有参数，「打包后能开」只能靠应用内入口        |
| 2   | 接口           | `DevMode`：`enabled` / `set(enabled)` / `onChange(listener)`，持久化在它里面；`ShellDebug` 保留为它的只读投影（日志、渲染 console 用） | 三源合并、持久化、订阅收在一处；删掉它，这些会散到 `app.ts` 与 `menu.ts`   |
| 3   | 入口           | 视图菜单一个勾选项（`⌘⇧D` / `Ctrl+Shift+D`），点了即时生效并写标记；`--zephyr-debug` 与标记文件仍可作为启动来源 | 一个入口，三个来源；菜单是它的唯一写口                                     |
| 4   | Inspector 接缝 | `InspectorPort`：`open(options?): { port, host, address }` / `close()` / `readonly opened` / `readonly address`（原文写 `readonly open`，与 `open()` 同名不可兼得，落地取名 `opened`）；适配器 `NodeInspector`（`node:inspector`） | 运行期可开可关；只绑 `127.0.0.1`；测试用假适配器，不必真开端口 |

| 5   | Inspector 端口 | 缺省 `9229`，被占则顺延（与 `WebServer` 同一条规矩），地址打到 `shell-entry.log` 并可从菜单复制 | 同一台机器上常同时开多份；端口冲突不该是错误                                |
| 6   | 菜单           | 开发者模式开：视图菜单出现 Reload / DevTools / 「打开主进程 Inspector」（勾选）/「复制 Inspector 地址」；关：收起并关掉 Inspector | 两个能力并列、各有开关，互不绑架                                            |

## 二、模块边界与接口

| 模块 | 拥有（职责与不变量） | 不拥有（明确排除） | 依赖方向 | 接缝 / 适配器 |
| ---- | -------------------- | ------------------ | -------- | ------------- |
| `DevMode` | 三源合并、运行期切换、持久化（userData 标记）、订阅 | 菜单怎么画、窗口怎么开 | 无 | 值对象（测试直接 new） |
| `InspectorPort` | 开关主进程 inspector、端口分配与回收、地址 | 菜单项文案、日志落盘 | → `node:inspector` | `NodeInspector`（假适配器用于测试） |
| 菜单 / 窗口 | 据 `DevMode` 与 `InspectorPort` 渲染、响应点击 | 状态本身 | ← 上面两个 | `menuTemplateOf(input)`（已是纯函数） |

## 三、行为与边界

- 启动读取三源 → `DevMode.enabled`；菜单据此渲染。
- 点「开发者模式」→ 写 userData 标记 → `onChange` 触发菜单重建（重开窗口不必）。
- 点「打开主进程 Inspector」→ `InspectorPort.open()` → 端口回写日志 + 菜单文案显示地址；再点关闭。
- 关开发者模式 → 关 Inspector、收起开发项、清空菜单里的地址。
- 退出：`quit()` 里关 Inspector（不残留端口）。
- 失败：Inspector 打不开（端口全占）→ 菜单项标灰 + 日志一行原因，不弹窗、不退出。

## 四、验收判据

| #   | 判据 | 证据 |
| --- | --- | --- |
| 1 | 打包形态无参数启动：视图菜单没有 Reload / DevTools / Inspector | 夹具渲染 `menuTemplateOf`，断言这几项不存在 |
| 2 | 点一次开发者模式：菜单出现开发项、userData 标记写出、重建菜单后仍为开 | 纯函数 + 临时目录测 `DevMode` 的持久化与订阅 |
| 3 | 打开 Inspector：端口可连、只绑 `127.0.0.1`、地址出现在返回值与日志行 | 真 `NodeInspector` 起一个随机端口连一次；假适配器测菜单文案 |
| 4 | 关开发者模式：Inspector 关闭、端口释放 | 同上，断言 `open === false` 且端口不再监听 |
| 5 | 退出：不残留监听 | 进程退出后 `lsof` 无记录（人工门 + 日志） |
| 6 | 命令行带 `--zephyr-debug` 启动：开发者模式为开、菜单里出现开发项 | 注入 argv 的纯用例（`DevMode.enabled === true`）+ 真机跑一次（`shell-entry.log` 里 `开发者模式 开`） |

## 五、取舍与债

- **启动参数叫 `--zephyr-debug` 而不是 `--debug`**：Electron 会先拿 Node 的开关表过一遍 argv，
  `--debug` 撞上已废弃的 `node --debug`，进程在入口求值前就退（真机读数：
  `electron: [DEP0062] \`node --debug\` and \`node --debug-brk\` are invalid`）。换名之后与
  `ZEPHYR_DESKTOP_*` 的环境变量前缀也对得上；三条来源与「菜单是唯一运行期写口」都不变。

- **只做 DevTools + 主进程 inspector**：不做上游那套跨 realm CDP（Host Worker + Client 只读 Sources）。我们的问题规模不需要它；将来若要在页面里断点调试 Client 代码，那是另一份设计。
- **端口顺延而不是固定**：地址要能复制给 Chrome DevTools，因此必须回写真实端口（与 `WebServer` 同一条规矩）。
- 债：开发者模式切换不重开窗口（DevTools 与菜单即时生效，但已注入的渲染 console 订阅只在窗口创建时挂一次）——若将来需要「开模式后立刻看到历史 console」，再改成可重挂。
