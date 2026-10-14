# @morlay/web-custom-profile

**前端装配层**：把 `@morlay/dsh-client-modules` 插成行，并停用被它取代的上游行（模块表 `modules`、
`client-hmr`、`frontend-static`）。

- **两种形态都要它**：dev（`dshdev web` / `dshdev desktop`）由工具按 `dsh.bundle.patch` 挂在 patch 栈顶；
  打包形态随 app 的 `dsh.profile.bundles` 进 profile——否则页面会落到上游的静态前端产物上，而产物里并没有它。
- 前端链路的设计与判据见
  [dsh-client-modules 的设计记录](../../client/dsh-client-modules/.agents/designs/20261013-客户端资源的联邦式预编译.md)。
