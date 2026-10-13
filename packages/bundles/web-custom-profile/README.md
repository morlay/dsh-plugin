# @morlay/web-custom-profile

**开发形态**（`dshdev dev`，web 与桌面两条路都算）挂的前端装配层：把 `@morlay/dsh-client-modules`
插成行，并停用被它取代的上游行（模块表 `modules`、`client-hmr`、`frontend-static`）。

- 它是**只给开发形态**用的 overlay：打包形态需要上游那几行，所以它不进 `dsh.profile.bundles`，
  而由宿主/工具在 dev 时按 `dsh.bundle.patch` 挂在 patch 栈顶。
- 前端链路的设计与判据见
  [dsh-client-modules 的设计记录](../../client/dsh-client-modules/.agents/designs/20261013-客户端资源的联邦式预编译.md)。
