// Desktop-profile composition of the bundled authoring dependencies: the payload tool
// (`@deepseek-ai/dsh-tool-workspace-dependencies`) is mounted, the docx / pptx / xlsx skills are not.
// Name, config fields and the argv contract stay upstream's; `tsdown` inlines the upstream module.

import type { Context } from "@deepseek-ai/cordis";
import * as workspaceDependencies from "@deepseek-ai/dsh-tool-workspace-dependencies";

// Loader identity for the application-owned workspace dependency composition.
export const name = "desktop-office";
// Application-selected bundled payload and installation directories.
export interface Config {
  // Bundled payload directory holding the primary runtime.
  readonly source: string;
  // Harness-home directory where workspace dependencies are installed.
  readonly root: string;
}

// Enable the bundled authoring dependencies in the Desktop profile.
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(workspaceDependencies, config);
}
