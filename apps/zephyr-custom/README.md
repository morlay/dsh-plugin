# zephyr-custom

本仓的 MVP 部署面：`just custom web` 起的就是它。

- 装配清单：[`src/zephyr.provide.ts`](./src/zephyr.provide.ts)（`customProvidersOf(features)`，顺序即装配顺序）
- 客户端清单：[`src/client/client.provide.ts`](./src/client/client.provide.ts)
- 入口：[`src/server.ts`](./src/server.ts)（只交出清单；装配、HMR 护栏与退出码归 `zephyr` CLI）

## 依赖只留「应用自己用到的东西」

判据是**两条**，不是只有 import：

1. **源码 import 的包**（`@morlay/*` 的业务包与框架包）；
2. **以字符串引用的包**：`remoteDescriptor("dsh-api-account-controller")` 这种运行时按包名解析的，
   必须由应用声明（没有 import 可查，删了会在装配期解析不到）；
3. **打包链按应用依赖取的包**：桌面闭包由 `pnpm deploy` 应用的依赖得来，壳里的 TS loader
   （`@morlay/dsh-oxc-node`）就按这条解析——源码里没有 import 也必须留着。

其余上游包一律由**提供方**声明：`@morlay/dsh-permission` 依赖 `@deepseek-ai/dsh-permission-presets`，
应用不需要再写一遍；pnpm 会把它链接到提供方自己的 `node_modules`，解析从 importer 走。

> 这条曾经反着写过（"上游依赖是前端解析锚点，不要按未 import 删"）：那时 `ClientRows` 按
> `createRequire(<app>/package.json)` 解析 client 半，锚点确实必需。那套机制已删除（见
> [`zephyr-cli` 的设计记录](../../packages/zephyr/zephyr-cli/.agents/designs/20261110-命令内核与四阶段.md)），
> 锚点随之失效。

## 文件职责

| 文件                                | 只做什么                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                      | **barrel**（re-export），不放实现。本应用现在**没有**这个文件：应用的入口只有下面两个，宿主侧不需要额外的包根。                 |
| `src/client/client.provide.ts`      | 客户端清单（`appClientProviders()`）。没有 barrel：`app-boot.ts` 直接从这里取。                                                 |
| `src/zephyr.provide.ts`             | **装配清单的唯一 home**：`customProvidersOf(rows, { dataDir })`，数组顺序就是装配顺序。                                         |
| `src/server.ts`                     | **服务端入口**：导出 `(mode) => 清单`。生命周期（装配 / 重载 / 端口 / 退出码）归 `zephyr` CLI，这里不放。                       |
| `src/dev-lifecycle.ts`              | 把框架的 `ServerHmr` 接到 CLI 的重载口上（什么时候可以换树由应用说，换树由 CLI 做）。                                           |
| `zephyr.config.ts`                  | 工作区配置：`server.entry`（清单）/ `client.entry`（**页面 `index.html`**，+ `vite` 片段）/ `desktop` / `dataDir`。唯一配置面。 |
| `zephyr.config.ts` 的 `client.vite` | 构建用的解析规则片段：`zephyrClientViteConfig()`（`@morlay/zephyr-app/build`）（alias / define / 装饰器），产物位置由 CLI 给。  |

规则：**`index.ts` 里出现实现或定义就是放错了位置**——挪到邻居文件，index 只 re-export。

## 组装验证

**本层不设测试门禁**（判据与理由见[设计](./.agents/designs/20261113-整装测试的分层与生命周期.md)）：

```
just custom build   # 组装能构建：静态面 + 运行时闭包 + 入口产物
```

另外看清单评审：对着 [`src/zephyr.provide.ts`](./src/zephyr.provide.ts) 与
[`src/client/client.provide.ts`](./src/client/client.provide.ts) 逐段读——依赖方在前、替换与剔除成对。
装配、渲染、wire 的行为判据归能力层与扩展包的 `__tests__`，不在本层重复。
