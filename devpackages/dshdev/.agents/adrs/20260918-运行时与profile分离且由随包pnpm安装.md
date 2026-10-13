# 运行时与 profile 分离且由随包 pnpm 安装

状态：已采纳

背景：桌面打包产物要支持 Web 插件页（`@deepseek-ai/dsh-plugin-manager`）的安装 / 卸载 / 启停，所以 profile
必须是 **pnpm 能接管的真项目**。deploy 闭包不是：它里面的包由工具手工复制补齐，不在 pnpm 的依赖图里，直接当
profile 用会让任何 `install` / `add` 把那些包 prune 掉，随后启停触发的 Loader 解析就报模块解析错误。

**决定**

打包种子拆成两棵树，profile 由随包 pnpm 离线安装：

- `seed/runtime`：不可变的 deploy 闭包，随包留在应用只读 resources 里，充当 host 的 dsh 安装锚点（Host
  `argv[2]` 的 runtimeDir）、前端静态资源来源，以及 profile `overrides` 指向的包源；
- `seed/profiles/desktop`：初始 profile，只声明 app 自己的 bundle（`file:./vendor/<name>`，`vendor/` 是从
  runtime 闭包 deref 复制出来的源）；
- 壳在种出 profile 后写入 `overrides`（`"@deepseek-ai/x": "link:<runtime>/node_modules/@deepseek-ai/x"`），
  再用随包 node 跑随包 pnpm 的 `install --prod --ignore-scripts --offline`；
- 壳把随包 pnpm 与 node bin 目录经 Host `argv[4]` / `argv[5]` 交给 host，成为
  `profileContext.packageManager`（`packages/desktop/dsh-desktop-host/src/index.ts:123-132` 读这两格）。

**考虑过的选项**

- **把 deploy 闭包直接当 profile**：依赖图与磁盘不一致（手工复制进去的包不在图里），任何包操作都会把它们
  prune 掉 → 否。
- **在 profile 里再复制一份完整闭包**：官方包与 dsh 出现两份实例，profile 多背一份 1.3G 量级的闭包 → 否。
- **profile 自己声明官方依赖、不写 `link:` 覆盖**：profile 里插件的 `@deepseek-ai/*` 依赖会各装一份，cordis
  不再是单例 → 否。

**后果**

- 指纹变化时壳在启动 host 前多一步 profile 安装；`DSH_HOME` 只放 profile，不持有运行时副本。
- 种子替换是**整目录替换**：profile 里用户装的插件要重装；手写在 `cordis.patch.yml` 里的设置由豁免逻辑保住
  （[债务 profile 的 `cordis.patch.yml` 豁免替换](../debts/20260922-profile的cordis.patch.yml豁免替换.md)）。
- profile manifest 只带 app 自己声明的 bundle，不带 app 的 `dsh.version` / `desktop` / `dev`（那些是打包输入）。
- `pnpm-workspace.yaml` 的 `overrides` 由壳写入；运行时包列表为空时不动文件，保留手写内容。
