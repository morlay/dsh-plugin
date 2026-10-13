// 全仓声明生成的 CLI 入口（`just dts` 用）：能力在 `dts.ts` 的 `generateWorkspaceDts`，
// 这里只负责找仓库根、计时与打印。
import { generateWorkspaceDts, repoRootOf } from "./dts.ts";

async function main(): Promise<void> {
  const root = await repoRootOf(process.cwd());
  const started = Date.now();
  await generateWorkspaceDts(root);
  console.log(`[dts] 全仓声明生成完成（${String(Date.now() - started)}ms）`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

// 说明：声明树由**构建**与**类型图生成**两处共用，所以生成与锁都收在 `@local/dts-prepare`。
