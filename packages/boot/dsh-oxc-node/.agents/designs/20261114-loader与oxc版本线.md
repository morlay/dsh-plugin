# loader 与 oxc 版本线（dsh-oxc-node）

状态：已实现——`oxc-transform` 与 `@oxc-project/runtime` 同锁 `0.154.x`，loader 用 `transformSync`。
范围：本包的依赖版本线约束、loader 的转译约定（target / 装饰器 / helper 改写）与冒烟判据。
非目标：Node 的 type stripping 策略；`@oxc-node/core` 的行为；产物构建链（rolldown / tsdown）。

## 一、决定

| #   | 议题         | 决定                                                                                                                                                     | 一句话理由                                                 |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | 版本线       | `oxc-transform` 与 `@oxc-project/runtime` 必须同一条 minor（当前都 `^0.154.0`）                                                                          | helper 的 specifier 形态与 native binding 都随大版本一起动 |
| 2   | 同步入口     | 用 `transformSync(filename, source, options)`（0.154 的同步 native 绑定）                                                                                | `registerHooks` 的 load 钩子必须同步返回                   |
| 3   | API 名的来源 | **API 名跟着依赖版本线**：0.75 只有 `transform`，0.154 有 `transformSync`；降级 / 升级必须同笔改 import 与调用点                                         | 依赖降级的代价不在语义，而在一句 `SyntaxError`             |
| 4   | 冒烟         | 一条命令验通：`node --import ./packages/boot/dsh-oxc-node/register.mjs --input-type=module -e "await import('./packages/agent/dsh-agent/src/index.ts')"` | 报错会精确停在那句具名导入上                               |

## 二、现状事实

- 依赖：`oxc-transform ^0.154.0`、`@oxc-project/runtime ^0.154.0`（`package.json`）；锁 `oxc-transform@0.154.0`。
- 导出面（`node -e 'const m=require("oxc-transform"); …'` 可复核）：0.154 的 `transformSync` 与 `transform` 都是函数；0.75.1 只有 `transform`。
- 转译约定：`target: "es2022"`（顶层 await 保得住、装饰器在这里降级）、`decorator: { legacy: true }`、helper 用默认 Runtime 形态，并把 `@oxc-project/runtime/helpers/*` 的 specifier 改写成 `src/helpers/esm/*.js` 的绝对 URL。
- 冒烟读数：加载 `packages/agent/dsh-agent/src/index.ts` → `LOADED keys: 55`。
- 桌面链路读数：`just custom desktop` 走到 `[dev] 已装配 153 行` + `[web] GET / → 200`；剩下的失败只有沙箱（`SingletonLock: Operation not permitted`、GPUCache EPERM）。
- 事故类（本设计要防的）：依赖被降级（`^0.154.0` → `^0.75.0`）而 `register.mjs` 没跟着改，症状是启动期一句 `SyntaxError: The requested module 'oxc-transform' does not provide an export named 'transformSync'`。

## 三、模块边界与接口

loader 只有 `register.mjs` 一个文件：它拥有「把 `.ts` 变成 Node 能吃的 ESM」与「helper specifier 的绝对化」；不拥有编译缓存、不拥有 target 的部署值（写死 `es2022`，要变就是改代码）。

## 四、行为与边界

- `.ts` 一律按 ESM 交回 Node（包 `type` 不参与判定），`node_modules` 下的 `.ts` 同样处理。
- 出错时把 oxc 的 `errors` 逐条打到 stderr 再抛：上游会把它吞成一句 `failed to import`。

## 五、验收判据

| #   | 判据（Done when） | 证据（命令）                                                                                                                 |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | 两条依赖同 minor  | `node -e 'console.log(require("oxc-transform/package.json").version, require("@oxc-project/runtime/package.json").version)'` |
| 2   | 同步入口存在      | `node -e 'if (typeof require("oxc-transform").transformSync !== "function") throw new Error("no transformSync")'`            |
| 3   | loader 冒烟       | 决定 4 那条命令退出码 0                                                                                                      |
| 4   | 桌面链路          | `just custom desktop` 走到「已装配 N 行」；除沙箱 EPERM 外无其它错误                                                         |

## 六、取舍

- **否掉「跟着 0.75 改代码用 `transform`」**：0.75 与 `@oxc-project/runtime 0.154` 不同线，helper 形态与 binding 都不配套；恢复依赖才是原状，改代码是在错误版本线上做适配。
- **否掉「两种 API 名都试」**：一个入口两种名字会让版本线彻底失去约束，下次升级还是靠猜。

## 七、不做与已知债

- **不锁死 patch 版本**（`^0.154.0`）：minor 内 API 名稳定，锁死只会让安全更新进不来。
- **沙箱 EPERM 与 loader 无关**（`SingletonLock` / GPUCache）：归桌面侧，不在本设计范围。

## 八、开放问题

- 「依赖版本线 + loader 冒烟」要不要挂进 `just lint` / CI？现在只有本文件的口头判据，靠人记。

## 九、装饰器告警：cwd 指向没有 tsconfig 的目录（取舍）

- **现象**：每个文件一行 `CONFIGURATION_FIELD_CONFLICT`——根 `tsconfig.json` 的 `experimentalDecorators: true` 与 transform 的 `decorator.legacy` 声明同一件事。
- **选择 B（已实现）**：保留 `decorator: { legacy: true }`，给 transform 的 options 加 `cwd: tmpdir()`，让 oxc 就近读不到仓库根那份 tsconfig；legacy 仍由选项显式给，对 `node_modules` 里的 `.ts`（祖先链没有 tsconfig）同样成立。
- **为什么不选 A（去掉 legacy 靠 tsconfig）**：`node_modules` 下的 `.ts` 没有祖先 tsconfig，去掉选项后它们的 legacy 装饰器不再降级——这正是原本要显式写 legacy 的理由。
- **cwd 的风险**：`cwd` 只影响 transform 选项里**相对路径**的解析；本 loader 传的都是绝对路径（`filename`/`source`），所以无影响。冒烟两条都在：①`dsh-agent/src/index.ts` 能加载、②`node_modules/@morlay/zephyr/src/token.ts`（带装饰器）能加载；两条 stderr 里 `CONFIGURATION_FIELD_CONFLICT` 计数都是 **0**。
