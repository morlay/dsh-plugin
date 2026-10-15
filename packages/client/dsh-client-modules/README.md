# @morlay/dsh-client-modules

客户端的**联邦预编译**链：按请求触发、按包产出，把三方包与仓库内的包统一成带版本的地址
（`/@client-modules/<pkg>@<version>/<export>`），dev 与打包形态共用同一条链、同一套插件。

- **dev**：宿主内起 vite（middleware 模式），裸说明符指向联邦地址、正在改的包逐文件走（HMR）；
- **打包**：直接跑 rolldown 产出到 profile 的缓存目录，路由按产物清单（`.files.json`）服务。

判据、分工与坑都在 [设计：客户端资源的联邦式预编译](./.agents/designs/20261013-客户端资源的联邦式预编译.md)
（URL 空间、出口名↔文件名、版本表、拆分配下限、两种形态的差异与 `--prod` 的验证面）。

被 [`@local/dshdev`](../../../devpackages/dshdev/README.md) 经 `@morlay/web-custom-profile` 挂进 profile；上游内部
文件按需 vendored 到各包的 `src/vendor/`（同步工具见 `@local/upstream-sync`）。
