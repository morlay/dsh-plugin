// @vitest-environment happy-dom
// L3：批量导入页面入口——多选 zip 一次请求（`sessionAdmin/importMany`），逐条结果聚合展示。
//
// 好包是**真导出**的产物（与生产导出同一条路径），坏包是一个没有 artifact 行的真 zip；
// 两条都经真 remote 到真库，断言落在「新会话真的在库里 / 提示里有没有那条失败的原因」。
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { strToU8 } from "fflate";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished, vi } from "vitest";
import { zh } from "../locales.ts";
import {
  seedTitledSession,
  startManagerFlow,
  type ManagerFlow,
} from "../../../__tests__/support/manager-flow.ts";
import { renderManagerPage } from "../../../__tests__/support/manager-render.tsx";
import { zipOf } from "../../../__tests__/support/zip.ts";

// 浏览器下载面：happy-dom 没有对象 URL，把导出的 zip 字节接住（拿它当导入源）。
function captureDownloads(): { blobs: Blob[]; filenames: string[] } {
  const blobs: Blob[] = [];
  const filenames: string[] = [];
  const target = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
  target.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return "blob:mock-" + String(blobs.length);
  };
  target.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filenames.push(this.download);
  });
  return { blobs, filenames };
}

async function start(): Promise<ManagerFlow> {
  const flow = await startManagerFlow();
  onTestFinished(() => flow.dispose());
  return flow;
}

describe("L3 对话管理页：批量导入", () => {
  test("多选两个 zip 一次导入：好包落成新会话，坏包按文件名给出原因", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "import-source", "要导出的会话");
    const downloads = captureDownloads();
    // 真导出拿包（文件名由宿主给：<会话>.zip）。
    await flow.face.exportZip("import-source");
    const source = downloads.blobs[0];
    if (source === undefined) throw new Error("export produced no zip");
    const good = new File([source], "import-source.zip", { type: "application/zip" });
    // 真 zip，但里面没有上游 format 的 artifact 行：宿主按包给 SESSION_IMPORT_NO_ARTIFACT。
    const badBytes = new Uint8Array(await zipOf({ "notes.txt": strToU8("not a session") }));
    const bad = new File([badBytes], "notes.zip", { type: "application/zip" });
    const container = renderManagerPage(flow);

    await screen.findByText("要导出的会话");
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    fireEvent.change(input, { target: { files: [good, bad] } });

    await waitFor(() => {
      expect(container.querySelector('[data-notice="result"]')).not.toBeNull();
    });
    const notice = container.querySelector('[data-notice="result"]')?.textContent ?? "";
    expect(notice).toContain("已导入 1 个会话，1 个失败。");
    expect(notice).toContain("notes.zip");
    expect(notice).toContain(zh["failure.importInvalidPackage"]);

    // 好包真的落成了一条新会话（列表里现在有两条：源会话 + 导入出来的）。
    await waitFor(async () => {
      const page = await flow.face.listRows({});
      expect(page.items.map((row) => row.title)).toContain("要导出的会话");
      expect(page.total).toBe(2);
    });
  });
});
