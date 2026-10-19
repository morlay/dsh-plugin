import { configuredProvider, Module, without } from "@morlay/zephyr";
import { FsSandbox, Sandbox } from "@morlay/dsh-base/sandbox";
import { SandboxLocal } from "@morlay/dsh-sandbox-local";

const access = [
  "rw /tmp",
  "rw {{ env.HOME }}/.agent-browser",
  "rw {{ env.XDG_CACHE_HOME }}",
  "rw {{ env.XDG_STATE_HOME }}",
  "rw {{ env.XDG_DATA_HOME }}",
  "r- {{ env.XDG_CONFIG_HOME }}",
  "-- mise.*.toml",
  "-- **/*.pem",
];

@Module({
  providers: [
    without(Sandbox),
    without(FsSandbox),
    configuredProvider(SandboxLocal, { access }),
  ],
})
export class SandboxProfileModule {}
