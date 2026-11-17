// 部署面必须注入的**源码转译器**：`DSH_SOURCE_LOADER` 指向 `@morlay/dsh-oxc-node` 的入口。
//
// 为什么必须有它：子进程载体（PTC 的 `ptc-runtime-node` 与 subprocess 的 runner）跑的是**源码面**的
// `.ts`。没有 loader 就落到 Node 内建的 strip-only 解析，撞上 vendor 里的参数属性
// （`constructor(private ctx)`）直接 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`——模型面看到的是
// 「run_code 一跑就失败」。上游把这个环境变量留成部署接缝（见 `patches/source-loader.patch`）。

/**
 * 注入 `DSH_SOURCE_LOADER`（`import.meta.resolve` 从**本模块**解析，不从装配根找）。
 *
 * 解析基准用本模块而不是装配根：loader 是独立包，哪一份都能转译任意 `.ts`（它自己注册 hooks，
 * 不关心被转译文件的包边界）。所以「仓库里那份」在 build / preview 形态下同样可用。
 * 已经有值就不覆盖：宿主或壳可以按自己的闭包给更准的那一份。
 * @returns 真正生效的 loader 入口（`file://` URL）。
 */
export function installSourceLoaderEnv(): string {
  const existing = process.env.DSH_SOURCE_LOADER;
  if (existing !== undefined && existing !== "") return existing;
  const loader = import.meta.resolve("@morlay/dsh-oxc-node");
  process.env.DSH_SOURCE_LOADER = loader;
  return loader;
}
