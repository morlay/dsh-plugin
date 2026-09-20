import { describe, expect, it } from "vitest";
import type { ReferenceInsert } from "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/draft-editor.ts";
import { insertTextOf, referenceTextOf } from "../client/input/reference-text.ts";

const fileInsert: ReferenceInsert = {
  source: "reference",
  ref: "@src/a.ts",
  label: "a.ts",
  appearance: "file",
  clipboardText: "@src/a.ts",
};

describe("referenceTextOf", () => {
  it("lands a file pick as the @ mention form", () => {
    expect(referenceTextOf(fileInsert)).toEqual({ ...fileInsert, clipboardText: "@src/a.ts" });
  });

  // 产生方给什么写法都在这里归一：草稿里只有预定的 `@` 形态一种写法。
  it("normalizes whatever spelling the producer handed over", () => {
    expect(referenceTextOf({ ...fileInsert, ref: "file:src/a.ts" }).clipboardText).toBe(
      "@src/a.ts",
    );
    expect(
      referenceTextOf({ ...fileInsert, ref: '@"my file.ts"', label: "my file.ts" }).clipboardText,
    ).toBe('@"my file.ts"');
    expect(
      referenceTextOf({ ...fileInsert, ref: "@src/dir/", label: "dir/", appearance: "folder" })
        .clipboardText,
    ).toBe("@src/dir/");
    expect(
      referenceTextOf({ ...fileInsert, ref: '@"my dir/', label: "my dir/", appearance: "folder" })
        .clipboardText,
    ).toBe('@"my dir/"');
  });

  it("keeps an insert it cannot read as a file reference", () => {
    const plain = { ...fileInsert, ref: "no-at-prefix", clipboardText: "no-at-prefix" };
    expect(referenceTextOf(plain)).toEqual(plain);

    const session: ReferenceInsert = {
      source: "reference",
      ref: "@[Research](dsh-session:InNvdXJjZSI)",
      label: "Research",
      appearance: "session",
      clipboardText: "@[Research](dsh-session:InNvdXJjZSI)",
    };
    expect(referenceTextOf(session)).toEqual(session);
  });
});

describe("insertTextOf", () => {
  it("lands a skill pick as a scheme token, keeping the closing space", () => {
    expect(insertTextOf("/code-review ")).toBe("skill:code-review ");
    expect(insertTextOf("/code-review")).toBe("skill:code-review");
  });

  it("keeps text that is not a whole skill token", () => {
    expect(insertTextOf("@src/")).toBe("@src/");
    expect(insertTextOf("/code-review 现在")).toBe("/code-review 现在");
    expect(insertTextOf("plain")).toBe("plain");
  });
});
