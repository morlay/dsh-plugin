// 两个宿主入口（桌面 [`./index.ts`](./index.ts) 与 web [`./web.ts`](./web.ts)）**共用**的启动参数。
//
// 为什么非要把这套 flag 抽出来：这两个入口拿到的输入完全同形——profile root、工具链根、形态自己的
// overlay、应用包通道、内层参数。以前桌面用位置参数（`argv[2]`/`argv[3]`）、web 用 `--profile-dir`
// 风格 flag，各自解析、各自组选项，"挂哪一层、锚点指哪"很容易只在一边改对，于是出现"dev 正常、打包
// 不对"这种只能靠猜的差异。现在只有这一处解析，两个入口的输入同形。

/** One host process invocation: what the process was asked to boot. */
export interface HostInvocation {
  /** profile root：dev 是 app 目录本身，打包是 `$DSH_HOME/profiles/<name>`。 */
  readonly profileDir: string;
  /** 工具链根（`node` / `pnpm` / loader）：不是依赖面。 */
  readonly runtimeDir: string;
  /** 形态自己的 overlay patch 文件，按 argv 顺序排在 bundle 层与 profile 自己的 patch 之后。 */
  readonly patches: string[];
  /** 应用包操作通道：随包 pnpm 的入口（缺省时插件页回退到进程 PATH）。 */
  readonly pnpmEntry?: string;
  /** 包通道要用的 node 可执行文件（打包形态的随包 node，与 `pnpm` 同属工具链）。 */
  readonly nodeBin?: string;
  /** `--` 之后的内层参数，原样交给树里 app 插件的 flag family。 */
  readonly inner: string[];
}

/**
 * 解析宿主入口的参数。
 * @param binName - 报错时前缀用的入口名（`dsh desktop` / `dsh web`）。
 * @param argv - `process.argv.slice(2)`。
 * @returns 两形态同形的启动参数。
 * @throws 缺两格锚点、该带值的参数缺值、或参数名不认识时。
 */
export function parseHostInvocation(binName: string, argv: readonly string[]): HostInvocation {
  let profileDir: string | undefined;
  let runtimeDir: string | undefined;
  let pnpmEntry: string | undefined;
  let nodeBin: string | undefined;
  const patches: string[] = [];
  const inner: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      inner.push(...argv.slice(index + 1));
      break;
    }
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${binName}: ${String(argument)} needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--profile-dir") profileDir = value();
    else if (argument === "--runtime-dir") runtimeDir = value();
    else if (argument === "--patch") patches.push(value());
    else if (argument === "--pnpm") pnpmEntry = value();
    else if (argument === "--node-bin") nodeBin = value();
    else throw new Error(`${binName}: unknown argument ${JSON.stringify(String(argument))}`);
  }
  if (profileDir === undefined || runtimeDir === undefined) {
    throw new Error(`${binName}: expected --profile-dir <dir> and --runtime-dir <dir>`);
  }
  return {
    profileDir,
    runtimeDir,
    patches,
    ...(pnpmEntry === undefined ? {} : { pnpmEntry }),
    ...(nodeBin === undefined ? {} : { nodeBin }),
    inner,
  };
}
