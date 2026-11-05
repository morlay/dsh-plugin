# @morlay/dsh-oxc-node

**本仓库的 TS 运行时入口**：注册 Node 的 module hooks，让 `node_modules` 下的 `.ts` 也能直接跑（ESM only）。

为什么需要它：Node 内建的 type stripping 拒绝对 `node_modules` 里的文件动手，而 `@oxc-node/core` 也刻意
放行那类文件（转译本身当然能做，只是那层策略不放）。这里自己注册 hooks、直接调 `oxc-transform`，
于是"源码面"（`exports` 指向 `src/*.ts` 的包）在壳与宿主里都能直接加载。

## 用法

```
node --import <本包>/register.mjs <入口>
```

- **壳**（`@morlay/zephyr-desktop-shell`）按路径把它交给宿主与子进程（见该包 `src/main.ts` 的 `loader`）；
- **启动器**（`zephyr-cli` 的 `preview`）与**桌面 dev**（`@morlay/zephyr-desktop-bundle` 的 `dev`）也用它加载闭包里的
  `.ts`——两处都按变量动态 import `register.mjs`（它没有类型声明）。

依赖方向：只有壳、启动器、桌面工具与应用依赖它；能力包不依赖它——它们本身就是被加载的源码面。
