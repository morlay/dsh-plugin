# @morlay/zephyr-cli

把 zephyr 工作区跑成（或打成）应用：`dev` 起开发形态，`build` 产出静态面与运行时闭包，`preview` 跑产物。
桌面命令不在这里——它们在 [`@morlay/zephyr-desktop-bundle`](../../zephyr-desktop/zephyr-desktop-bundle/README.md) 里，
通过配置清单追加进来。

## 用法

| 命令                      | 作用                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zephyr dev [工作区]`     | 装配应用清单（含 vite HMR），服务端源码变了就整棵换树                                                                                                            |
| `zephyr build [工作区]`   | 产出一份**可分发应用**到 `server.outputDir`（缺省 `target/<应用名>/`）：`client_modules/` + `node_modules/` + `src/server.ts` + `bootstrap.mjs` + `package.json` |
| `zephyr preview [工作区]` | 只吃已有产物（缺 `bootstrap.mjs` / `client_modules/` 就报错，不回退重建），跑 `bootstrap.mjs`                                                                    |

全局选项：`--config <路径>`、`--data-dir <workspace|xdg|绝对路径>`、`--port <n>`、`--host <h>`、
`--log-level <debug|info|warn|error|silent>`。

## 工作区配置

唯一配置面是工作区根的 `zephyr.config.ts`（裸对象，不用 `defineConfig`）。它描述**这个工作区是什么**，
不描述 CLI 有哪些命令——核心三条命令永远存在，help 永远稳定：

```ts
import { provideDesktopBundle } from "@morlay/zephyr-desktop-bundle";
import type { ZephyrConfig } from "@morlay/zephyr-cli";

export default {
  // 服务端入口：这个文件默认导出一份 provider 清单（应用装全，CLI 只 bootstrap）
  server: { entry: "./src/server.ts" },
  // 页面入口就是 index.html（vite 的 root 是它的目录、input 是它自己）；
  // `vite` 是**内联的配置片段**（框架导出的解析规则：alias / define / 装饰器），
  // 产物位置由 CLI 叠上去——不需要额外的 vite.config.ts
  client: {
    entry: "./src/client/index.html",
    vite: zephyrClientViteConfig({ repoRoot: import.meta.dirname }),
  },
  desktop: {
    id: "ai.deepseek.zephyr.custom-next",
    name: "Zephyr Custom",
    window: { width: 1280, height: 800 },
  },
  // dev 形态的开关：HMR 的两半（客户端 vite 热更 / 服务端换树），缺省都开——只写要关的那一半
  dev: { hmr: { server: false } },
  dataDir: "workspace",
  // 插件是**内联展开**的清单条目：装的什么、命令从哪来，一眼看得到
  plugins: [...provideDesktopBundle()],
} satisfies ZephyrConfig;
```

**临时关掉 HMR 不必改文件**：`ZEPHYR_HMR_CLIENT` / `ZEPHYR_HMR_SERVER` 覆盖配置里的同名开关
（`0|false|off|no` 关，`1|true|on|yes` 开），例如 `ZEPHYR_HMR_SERVER=0 just dev`。
优先级：环境变量 > 配置 > 缺省（开）；取值写错当场报错（不静默忽略）。

## 写一条命令

命令就是一个装配行：`@Injectable` 类 + `path` + `params` + `run`，放进清单就被 CLI 看见。
`params` 是手写的声明，**声明即自动注册为 flags**（布尔还会自动有 `--no-` 反向），`--help` 由它生成。

```ts
import { Command, type CommandInput, type ParamSpecs } from "@morlay/zephyr-cli";
import { Injectable } from "@morlay/zephyr";

@Injectable({ multi: true }) // 多值标记不会自动继承：漏写会让后一个命令静默覆盖前一个
export class EchoCommand extends Command {
  readonly path = ["echo"];
  readonly description = "回显实参";
  readonly params: ParamSpecs = {
    loud: { kind: "boolean", description: "加感叹号" },
  };

  async run(input: CommandInput): Promise<number> {
    return input.params.loud === true ? 1 : 0;
  }
}
```

树的组装是 CLI 的职责：`config.plugins` 里的命令都进 `app.getAll(Command)`，按各自的 `path` 摆成树；
父路径没有对应命令、或同一路径注册两次，都算**装配错误**（不是运行期错误）。

## 产物

`server.outputDir`（缺省 `target/<应用名>/`）**就是一份可分发的应用**，整目录可删、可整体拷走：

```text
<outputDir>/
  client_modules/   静态前端（index.html + 按包联邦产物 + .files.json）
  node_modules/     宿主闭包（pnpm deploy --prod，含 loader）
  src/server.ts     源码面入口（闭包里的 loader 直接跑它，不打单文件）
  bootstrap.mjs     生产态装配（部署值内联在这里）
  package.json      应用清单
```

构建**每轮整目录重建**：`<outputDir>` 里没有跨轮复用的缓存目录，因此也没有「缓存与产物两份字节」的问题。

## 设计

- [命令内核与四阶段](./.agents/designs/20261110-命令内核与四阶段.md)
