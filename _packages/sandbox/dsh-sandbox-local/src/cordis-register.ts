import { toCordis } from "@morlay/zephyr/compat";
import { Config, type ResolvedConfig } from "./config.ts";
import { FilesystemService, SandboxLocal, SandboxService } from "./zephyr.service.ts";

export default toCordis(SandboxLocal, {
  Config,
  providers: (config) => [
    { provide: SandboxService, useValue: config as ResolvedConfig },
    { provide: FilesystemService, useValue: config as ResolvedConfig },
    { provide: SandboxLocal, useValue: config as ResolvedConfig },
  ],
});
