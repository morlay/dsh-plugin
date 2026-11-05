import { describe, expect, it } from "vitest";
import { Command, type CommandInput } from "../command.ts";
import { CliError } from "../errors.ts";
import { buildCommandTree, childNamesOf, resolveCommand } from "../tree.ts";

/** 一个只有路径的假命令。 */
class FakeCommand extends Command {
  constructor(
    readonly path: readonly string[],
    readonly description = "假命令",
  ) {
    super();
  }

  async run(_input: CommandInput): Promise<number> {
    return 0;
  }
}

describe("命令树", () => {
  it("按 path 摆成树，父子都看得见", () => {
    const tree = buildCommandTree([
      new FakeCommand(["dev"]),
      new FakeCommand(["desktop"]),
      new FakeCommand(["desktop", "bundle"]),
    ]);
    expect(childNamesOf(tree)).toEqual(["dev", "desktop"]);
    expect(childNamesOf(tree.children[1]!)).toEqual(["bundle"]);
  });

  it("父命令没注册就算装配错误：分组在 help 里没有自己的说明", () => {
    expect(() => buildCommandTree([new FakeCommand(["desktop", "bundle"])])).toThrowError(
      /先注册父命令/u,
    );
  });

  it("同一路径注册两次是装配错误", () => {
    expect(() =>
      buildCommandTree([new FakeCommand(["dev"]), new FakeCommand(["dev"])]),
    ).toThrowError(/重复注册/u);
  });

  it("解析时尽量多吃命令段，剩下的交回命令", () => {
    const tree = buildCommandTree([
      new FakeCommand(["desktop"]),
      new FakeCommand(["desktop", "bundle"]),
      new FakeCommand(["dev"]),
    ]);
    expect(resolveCommand(tree, ["desktop", "bundle", "--dir"])?.argv).toEqual(["--dir"]);
    expect(resolveCommand(tree, ["dev", "/work"])?.argv).toEqual(["/work"]);
    expect(resolveCommand(tree, ["nope"])).toBeUndefined();
  });

  it("没有命令的裸调用不是错误，只是没有匹配", () => {
    const tree = buildCommandTree([new FakeCommand(["dev"])]);
    expect(resolveCommand(tree, [])).toBeUndefined();
    expect(CliError.prototype.isPrototypeOf(new CliError("x"))).toBe(true);
  });
});
