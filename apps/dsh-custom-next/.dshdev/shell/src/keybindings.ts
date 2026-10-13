// 设备本地的快捷键偏好（Electron userData 下）：原子替换、单写者协调。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { ShortcutPersistence } from "@deepseek-ai/dsh-client-shortcuts/protocol";
import type {
  ShortcutConfigSnapshot,
  ShortcutPlatform,
} from "@deepseek-ai/dsh-client-shortcuts/protocol";

// 打开设备配置（原子替换），返回单写者事务协调器；`userData` 不接受渲染进程给的路径。
export function desktopKeybindings(
  userData: string,
  platform: ShortcutPlatform,
  publish: (snapshot: ShortcutConfigSnapshot) => void,
): ShortcutPersistence {
  const path = join(userData, "keybindings.json");
  return new ShortcutPersistence(
    {
      read: async () => {
        try {
          return await readFile(path, "utf8");
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      },
      write: (raw) => writeFileAtomic(path, raw, { mode: 0o600, dirMode: 0o700 }),
    },
    "desktop",
    platform,
    false,
    publish,
  );
}
