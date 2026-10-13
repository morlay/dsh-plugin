/**
 * 三方依赖的预打包（`@deps/`）：**与聚合同一条链**（vite 的 build、同一份 CSS/资产插件），
 * 差别只在输入是 `node_modules` 里的包，且嵌套依赖也落 `@deps/`——整条依赖闭包因此同构。
 *
 * 这样 react 这类不需要特殊照顾：裸说明符外置后由 `paths` 统一指过来，两边共用同一份实例。
 */
import { createRequire } from "node:module";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { clientAssetPlugin, cssInlinePlugins } from "@local/tsdown-plugin-cordis";
import { build } from "vite";
import { packageNameOf } from "./resolve.ts";

/** 依赖在浏览器里的地址。 */
export const CLIENT_MODULES_PREFIX = "/@client-modules";

/**
 * 依赖/插件在浏览器里的地址：**同一个前缀、同一种形态**（`<pkg>/<file>`）。
 *
 * 三方（react）是 `<pkg>/index.js`；我们自己的包是 `<pkg>/client.js`（它的出口就叫 client）。
 * 两侧同构，所以"依赖"与"插件"对外是同一套命名空间，"全面统一"。
 *
 * @param name - 包名。
 * @param file - 产物文件名（默认 `index.js`）。
 * @returns 浏览器地址。
 */
/** 依赖/插件在浏览器里的地址（联邦式：`<pkg>@<version>/<file>`）。 */
export function depsUrlOf(specifier: string, version: string, file = "index.js"): string {
  // 归一到**包名**：说明符可能带子路径（`@deepseek-ai/dsh-x/client`、`react/jsx-dev-runtime`），
  // 联邦地址按包寻址。
  const name = packageNameOf(specifier) || specifier;
  return `${CLIENT_MODULES_PREFIX}/${name.replaceAll("/", "+")}@${version}/${file}`;
}

/** 从 `@deps/` 地址回推包名。 */
export function depNameOf(segment: string): string {
  return segment.replace(/\.js$/u, "").replaceAll("+", "/");
}

/**
 * 确保某个依赖的产物在（清单没变就直接用）。
 *
 * @param options.cacheRoot - 缓存根（`node_modules/.dsh-deps`）。
 * @param options.repoRoot - 仓库根（vite 的 root）。
 * @param options.from - 解析基准（某份真实清单；pnpm 的软链由 node 解开）。
 * @param options.alias - 与 dev 共用的 alias。
 * @param options.name - 包名。
 * @returns 落盘路径（相对缓存根）；解析不到时 undefined。
 */
export async function bundleDep(options: {
  cacheRoot: string;
  repoRoot: string;
  from: string;
  alias: readonly { find: RegExp | string; replacement: string }[];
  /** 我们的包名集合：外置它们的说明符时指向 `client.js`（与聚合产物同名）。 */
  ownNames?: ReadonlySet<string>;
  /** 包名 → 版本：URL 里要带（联邦式的寻址）。 */
  versions?: ReadonlyMap<string, string>;
  /** 该包是否是我们自己的（决定产物名）。 */
  own?: boolean;
  name: string;
}): Promise<string | undefined> {
  const require = createRequire(options.from);
  let entry: string;
  try {
    entry = require.resolve(options.name);
  } catch {
    return undefined;
  }
  const pkgJson = await packageJsonNear(entry);
  const source = await readFile(pkgJson, "utf8").catch(() => "");
  const info = await stat(entry).catch(() => undefined);
  // 指纹：清单 + 入口（三方在 dev 期间不会改，够用且便宜）。
  // 同样带构建器版本（见 `bundle.ts` 的说明：规则变了要作废旧产物）。
  const rev = `2:${String(source.length)}:${String(info?.size ?? 0)}:${source.slice(-64)}`;
  const key = options.name.replaceAll("/", "+");
  // 我们的包（工作区里的）产物按出口命名（`client.js`）；三方是 `index.js`。两侧同构。
  const fileName = options.own === true ? "client.js" : "index.js";
  const dir = join(options.cacheRoot, key);
  const stamp = join(dir, ".dep.json");
  const cached = JSON.parse(await readFile(stamp, "utf8").catch(() => "{}")) as {
    rev?: string;
  };
  if (cached.rev === rev) return `${key}/${fileName}`;

  const result = await build({
    configFile: false,
    root: options.repoRoot,
    logLevel: "silent",
    publicDir: false,
    define: { "process.env": "{ env: {} }" },
    resolve: { alias: options.alias },
    plugins: [
      cssInlinePlugins({ name: key, assets: "threshold" }),
      clientAssetPlugin(),
    ] as never,
    build: {
      write: false,
      minify: false,
      target: "esnext",
      rollupOptions: {
        input: { index: entry },
        external: (id: string) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
        output: {
          format: "es",
          entryFileNames: fileName,
          paths: (id: string) => {
            if (id.startsWith("node:")) return id;
            // `paths` 收到的是**说明符**（可能是子路径，如 `@deepseek-ai/dsh-x/client`）：先归一到包名，
            // 再看它是不是我们这个工作区里的（决定出口名），版本从预建的表里取（回调不能 await）。
            const bare = packageNameOf(id) || id;
            const own = options.ownNames?.has(bare) === true;
            return depsUrlOf(id, options.versions?.get(bare) ?? "0.0.0", own ? "client.js" : "index.js");
          },
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).filter((item) => "output" in item) as {
    output: readonly { type: string; code: string }[];
  }[];
  const chunk = outputs.flatMap((item) => item.output).find((item) => item.type === "chunk");
  if (chunk === undefined || chunk.type !== "chunk") return undefined;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), chunk.code, "utf8");
  await writeFile(stamp, `${JSON.stringify({ rev }, null, 2)}\n`, "utf8");
  return `${key}/${fileName}`;
}

/** 从入口文件向上找它所属包的 `package.json`。 */
async function packageJsonNear(file: string): Promise<string> {
  let directory = dirname(file);
  for (;;) {
    const candidate = join(directory, "package.json");
    if (await readFile(candidate, "utf8").then(() => true, () => false)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return candidate;
    directory = parent;
  }
}
