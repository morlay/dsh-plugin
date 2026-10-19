/**
 * `without(...)` 是**清单 feature**（Angular 的 `without(...)` 同形）：
 * 无条件的那种把条目剔掉，带表达式的保留（表达式只用于 patch 的 disabled）。
 */
import { describe, expect, it } from "vitest";
import { Injectable } from "../token.ts";
import { bootstrapApplication } from "../bootstrap.ts";
import { without } from "../provider.ts";

@Injectable()
class KeptProvider {}

@Injectable()
class DroppedProvider {}

describe("without feature", () => {
  it("无条件 without 剔除条目；带表达式的保留条目", { timeout: 20_000 }, async () => {
    const providers = without(KeptProvider, false)([KeptProvider, DroppedProvider]);
    const app = await bootstrapApplication({
      providers: without(DroppedProvider)(providers),
    });
    try {
      expect(app.get(KeptProvider)).toBeDefined();
      expect(() => app.get(DroppedProvider)).toThrow();
    } finally {
      await app.dispose();
    }
  });
});
