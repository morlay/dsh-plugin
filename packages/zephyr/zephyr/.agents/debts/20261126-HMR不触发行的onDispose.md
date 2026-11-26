# 债：开发期 HMR 不触发 zephyr 行的 `onDispose`

状态：已知，框架层统一修（2026-11-26 记录）。

## 事实

dev 热更新替换某个行的模块时，旧实例的 `onDispose` **不会被执行**，于是它在**跨行共享注册表**里留下的注册还在，
新实例 `onInit` 再注册一次就抛：

```
Error: sidebarRight: tab kind "guide" is already registered
```
（`?v=40ed27ea` 这类 Vite 模块版本号出现在栈里，就是 HMR 替换的证据。）

根因是「注册怎么挂」：

| 谁 | 注册挂在哪 | HMR 时会被回收吗 |
| --- | --- | --- |
| 上游行（`ui-sidebar-*` 等） | `ctx.effect(...)` | 会（cordis fiber 回收） |
| 我们的行 | `onDispose`（zephyr 生命周期） | **不会** |

## 受影响（同一缺口）

| 位置 | 注册表 | 现状 |
| --- | --- | --- |
| `dsh-conversation/src/ui/shell/rightbar-seats.ts` | `SidebarRightTabs.register`（guide） | **已临时幂等**（`tabs.face.get(GUIDE_ID) === undefined` 才注册，注释写明是 HMR 容忍） |
| `zephyr-desktop-panel/src/ui/panel-tab.ts` | 同上（desktop panel 类型） | 未处理（现在未被触发） |
| `session-mode/src/ui/session-mode-panel-tab.ts` | 同上（session-mode 类型） | 未处理（现在未被触发） |

## 修法（框架层，一处覆盖所有行）

在 `zephyr` 的装配入口（`provide` 或 `bootstrapClient`）挂开发期钩子：

```ts
// dev-only：模块被 HMR 替换时，先把旧实例按卸载路径 dispose（等价于上游 ctx.effect 的回收语义）
import.meta.hot?.dispose(() => { void application.dispose() })
```

落地后：**撤掉 `rightbar-seats.ts` 里 guide 的临时幂等**（幂等会把「第 4 处忘了」的问题藏起来）。

## 判据

- dev 下连续保存 `rightbar-seats.ts` 多次，控制台不再出现 `already registered`；
- 生产（`just custom build` + preview）本来就只有一次 `onInit`，不受影响（已静态确认：`guideDefinition` 全仓只有一处注册）。

## 相关风险：批量注册里任一失败会中断后续

`onInit` 里连着 `register` 多条时（guide 的类型 + 正文 + 标题，或一个域行里的几个 tab 类型），**第一条抛错后面全不执行**，
而错误栈只指第一条。典型症状：

- HMR 下 `already registered` 抛在 guide 类型上 → 同批的正文/标题注册没跑；
- 更远的地方表现成「终端/文件/浏览器那几个 tab 类型莫名不出现」。

缓解方向：**逐条独立注册**（每条自己 try/catch 并打出行名与 kind），或把「同批必须一起成功」的注册放进 `ctx.effect` 的 generator
（cordis 会整体回滚）。不要用一个裸 `for` + 一个 try 包住整批——那样错误定位会退到「第一条」。
