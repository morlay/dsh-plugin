# 决定：本包样式走上游那套 CSS Modules

状态：已采纳——本包的样式全部是 `X.module.css`（lightningcss 编译并内联），token 直接写 `var(--dsw-*)`；没有自建样式层。
背景：官方 `@deepseek-ai/dsh-client-ui-primitives` 每个组件一个 `.module.css`，token 直接写 `var(--dsw-*)`。两套样式机制在同一页面上并存的话，业务借用官方类名、本包注入自己的类，两边都要各自兜一遍优先级。

另外两条现状让它可行：

- **构建链支持 `.module.css`**：编译与内联的实现在 `packages/zephyr/zephyr-app/src/cordis-assets/styles.ts`（`cssInlinePlugins`），dev 逐文件与联邦构建两条链共用同一份，class 名与注入方式同形。
- **预编译本来就是上游客户端的形态**：client 半从来不是「源码直载就完事」。

**决定**

本包的样式全部改成上游那套：

- 每件组件一个 `X.module.css`，组件里 `import css from "./X.module.css"`，token 直接写 `var(--dsw-*)`；
- **能 re-export 就 re-export**：设置表单原语不 fork（上游那份就是 CSS Modules），本包只留官方没有的 `SettingsFieldRow`；`Button` / `DisclosureRow` 是本包包装版（官方那份 + 固定修饰）；
- **不能复用就组合上游**：`TagInput`、`SearchSelect`、`ModelRouteList`、`MultilineField`、`IconButton`、`SeatButton` 各配一个 `.module.css`；
- **布局原语只给 `Stack` / `Row` / `Text`**（档位表在 `layout.module.css` + `scales.ts`），业务插件只组合、不写样式（这条同时写进[如何写](./../standards/how-to-write.md)）。

**考虑过的选项**

| 选项                                            | 否掉的理由                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| 保留 css-in-js，只把它做得更像上游              | 两套机制继续并存，类名 / 优先级冲突与重复基建都留着                                   |
| 业务层自己写 `.module.css`                      | 与「业务只组合」直接冲突：同一页面上两个消费方各写一份卡片 / 分组的几何，视觉立刻漂移 |
| CSS Modules + 上游 re-export + 布局原语（选定） | 上游升级时本包的 `.module.css` 要跟着对；档位表要自己维护                             |

**后果**

- 与官方同一套技术栈：类名同源、token 同源、焦点环与控件几何一致。
- 业务插件不写 `.styles.ts`：页面只写结构与档位；视觉要改就改本包（一处生效）。
- 测试不断言样式对象（那是 css-in-js 的产物）：断言改为「元素带上了哪个 `data-role` / 哪个类」，布局由页面端到端看。
- dev 与构建两条链都要过一次 lightningcss（同一个 `cssInlinePlugins`）。
- 本包没有自己的 `tsdown.config.ts`：构建走仓库根 `just build`，产物是普通 ESM 库。
