# @local/tsdown-plugin-cordis

cordis 插件包的 tsdown 配置与清单写回：一个插件管住"这个包该怎么打"，并把 `exports` /
`publishConfig.exports` / `engines.dsh` 从产物推导后写回 `package.json`。只在构建期跑，发布物里没有它。

## 用法

```ts
// packages/<组>/<包>/tsdown.config.ts
import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  // 入口归 tsdown：插件只消费它。**写对象形**（entry 名就是产物名与出口键）；
  // `src/index.ts` 在就自动成为 `.` 出口，`src/client/index.ts` 在就附带 client 半。
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  plugins: [cordisPlugin({ bin: { zephyr: "cli" } })],
});
```

一个包要产出多份配置时（桌面壳这类）用 `buildCordisConfig(options, incoming)` 直接拿整份
`UserConfig`。选项见 `src/cordis-host.ts` 的 `CordisPluginOptions`：`client` / `inline` /
`neverBundle` / `outDir` / `fixedExtension` / `dts` / `hidden` / `bin` / `legacy`。

构建时发生的事：

- **依赖内外联**：host 面外置依赖，`@local/*` 与 `inline` 点名的包内联；client 面按 `peerDependencies`
  分流（命中的外置、其余内联），样式与资产内联成自包含单文件。
- **声明不进 tsdown**：由 [`@local/dts-prepare`](../dts-prepare/src/dts.ts) 的 `emitDts` 从全仓声明树
  `target/dts` 按路径取来合并，所以 tsdown 的 `dts` 关掉。
- **清单写回**：产物齐了写一次——`exports` 指源码、`publishConfig.exports` 指产物、`engines.dsh` 取
  构建环境的 `DEEPSEEK_HARNESS_VERSION`（缺失或认不出就不写，不失败）。
- **没有源码入口的数据包**（只有 patch / locale / icon）：用 `writePackageManifest(cwd)` 单独写，口径同一份。

## 与手写清单的关系

`exports` / `publishConfig.exports` / `engines.dsh` 是产物推导的结论，**接入之后不许手改**：手写已经漂移
（`packages/zephyr-desktop/zephyr-desktop-shell` 的 `publishConfig.exports` 缺 `./main`，
`packages/agent/dsh-workspace` 的只留了两个键）。固定面按文件存在性补（`./package.json`、
`./cordis.patch.yml`、`./locale/*.json`），其余按入口名逐个生成；不写 `./src/*`——那会让消费方伸手进任意源码。

## 接入状态

**未接入**：没有任何 `packages/**` 的构建引用本包，现有清单仍是手写。边界、接入形态与判据见
[`.agents/designs/20261113-迁移与接入边界.md`](./.agents/designs/20261113-迁移与接入边界.md)。

## 验证

```sh
pnpm exec vitest run devpackages/tsdown-plugin-cordis
pnpm exec oxlint devpackages/tsdown-plugin-cordis
```

判据与接缝见 [`.agents/standards/how-to-verify.md`](./.agents/standards/how-to-verify.md)。
