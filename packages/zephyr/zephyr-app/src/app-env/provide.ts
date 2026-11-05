import { provide } from "@morlay/zephyr";
import { AppEnvDefault } from "./app-env.service.ts";

/** 部署参数的装配面：值由启动器经 `configure(AppEnvDefault, {...})` 给（路径、档位只有它知道）。 */
export const provideAppEnv = provide([AppEnvDefault]);
