# bundle 只生成 patch，不生成 index.ts

状态：已采纳

背景：dsh 的 bundle 只贡献装配层：`dsh.bundle.patch` 指向 `cordis.patch.yml`，profile 按 bundle 顺序把 patch 叠在空入口表上。bundle 的 JS 入口不被 Loader 当插件装载。能力包才是行。

**决定**

bundle 的源码真源是 `@Module`（`imports` / `providers` / `dsh` 行操作）。构建工具从 Module 提取信息，只生成 bundle 的 `cordis.patch.yml`；不生成 bundle 的 `index.ts`。能力包的 dsh 入口由 `toCordis()` 在运行期转换，生成器不写能力包入口。

**考虑过的选项**

- 生成 bundle 的 index.ts 作为容器/插件入口：profile 不装载它，没有调用方；还会诱导出「bundle 一行接管」的形态，破坏行级设置面。
- 生成能力包入口：`toCordis()` 已经能在运行期完成转换，生成的代码只会重复一遍。
- 手写 patch：回到 `tsdown.config.ts` 的 ROWS 清单，Module 就不是唯一真源。

**后果**

- bundle 的 patch 仍由构建写回、入库、测试比对（沿用现有 `patch.spec.ts`）。
- Module 必须能表达现有的 `disabled` / `config` / `insert` 三类行操作；非 insert 操作的声明形状在第二阶段定。
- 能力包仍需在 `package.json` 里保留 `cordis.patch.yml` 之外的入口（host 面 + Config），并保证 Loader 能取到 `toCordis()` 的 default export。
