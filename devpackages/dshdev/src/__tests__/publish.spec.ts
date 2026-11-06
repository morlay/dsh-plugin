import { describe, expect, it } from "vitest";
import { distTagOf, publishOutcome } from "../cli/publish.ts";

describe("distTagOf", () => {
  it("maps stable versions to latest and prereleases to alpha / next", () => {
    expect(distTagOf("0.2.11")).toBe("latest");
    expect(distTagOf("0.2.11-alpha.2")).toBe("alpha");
    expect(distTagOf("0.2.11-rc.1")).toBe("next");
    expect(distTagOf("0.2.11-beta.3+build.7")).toBe("next");
  });
});

describe("publishOutcome", () => {
  it("treats a zero exit as published", () => {
    expect(publishOutcome({ status: 0, stderr: "" })).toBe("published");
  });

  it("treats 409 as already published (another job won the race)", () => {
    expect(publishOutcome({ status: 409, stderr: "" })).toBe("already-published");
  });

  it("treats npm's 403 'cannot publish over the previously published versions' as already published", () => {
    expect(
      publishOutcome({
        status: 1,
        stderr:
          'Error: ERR_PNPM_FAILED_TO_PUBLISH\n\n  × Failed to publish package @morlay/dsh-oxc-node@0.2.11 (status 403 Forbidden): ' +
          '{"success":false,"error":"You cannot publish over the previously published versions: 0.2.11."}',
      }),
    ).toBe("already-published");
  });

  it("treats EPUBLISHCONFLICT as already published", () => {
    expect(
      publishOutcome({ status: 1, stderr: "npm ERR! code EPUBLISHCONFLICT: cannot publish over" }),
    ).toBe("already-published");
  });

  it("keeps real failures as failures", () => {
    expect(
      publishOutcome({
        status: 1,
        stderr: "status 403 Forbidden: You do not have permission to publish this package.",
      }),
    ).toBe("failed");
    expect(publishOutcome({ status: null, stderr: "" })).toBe("failed");
  });
});
