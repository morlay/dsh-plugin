import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_PORT, parseWebInvocation, webArgs } from "../web.ts";

describe("web 入口的参数", () => {
  it("取两格锚点、overlay 与 `--` 之后的内层参数", () => {
    expect(
      parseWebInvocation([
        "--profile-dir",
        "/app",
        "--runtime-dir",
        "/runtime",
        "--patch",
        "/host/dev-client.cordis.patch.yml",
        "--patch",
        "/extra.yml",
        "--",
        "--no-open",
        "--host",
        "127.0.0.1",
      ]),
    ).toEqual({
      profileDir: "/app",
      runtimeDir: "/runtime",
      patches: ["/host/dev-client.cordis.patch.yml", "/extra.yml"],
      inner: ["--no-open", "--host", "127.0.0.1"],
    });
  });

  it("缺锚点或缺值、参数不认识时都失败", () => {
    expect(() => parseWebInvocation([])).toThrow(/--profile-dir/u);
    expect(() => parseWebInvocation(["--profile-dir", "/app"])).toThrow(/--runtime-dir/u);
    expect(() => parseWebInvocation(["--profile-dir", "/app", "--runtime-dir"])).toThrow(
      /needs a value/u,
    );
    expect(() => parseWebInvocation(["--nope"])).toThrow(/unknown argument/u);
  });
});

describe("web 端口契约", () => {
  it("内层没给 --port 时补上 PORT（缺省 3080）", () => {
    expect(webArgs([], DEFAULT_WEB_PORT)).toEqual(["--port", "3080"]);
    expect(webArgs(["--no-open"], "4000")).toEqual(["--port", "4000", "--no-open"]);
  });

  it("内层显式给了 --port 就以它为准", () => {
    expect(webArgs(["--port", "8080"], "4000")).toEqual(["--port", "8080"]);
  });
});
