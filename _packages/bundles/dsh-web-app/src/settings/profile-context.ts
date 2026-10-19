// `profileContext` 是 launcher 提供的只读装配事实（`config-editor` / `settings` 都按名字取它）。
// 令牌只声明形状；值由启动器（`apps/*/src/profile-context.ts`）用 `useFactory` 提供。
import { InjectionToken } from "@morlay/zephyr";

export interface ProfileContext {
  readonly name: string;
  readonly dir: string;
  readonly patchPath: string;
  readonly installAnchor: string;
  readonly cwd: string;
  readonly home: string;
  readonly startedBundles: readonly string[];
  readonly overlays: readonly unknown[];
  readonly telemetryDisabledEnv: string | undefined;
}

export const ProfileContextToken = new InjectionToken<ProfileContext>("profileContext");
