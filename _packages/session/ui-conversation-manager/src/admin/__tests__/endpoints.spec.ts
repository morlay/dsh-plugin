// 管理面端点的场景闭环：HTTP 层只负责请求解析与响应映射，行为在 SessionAdmin 上覆盖。
import { afterEach, describe, expect, it } from "vitest";
import { unzip } from "fflate";
import { Connection } from "@morlay/dsh-base/connection";
import { WebServer } from "@morlay/dsh-base/web-server";
import {
  SESSION_DELETE_PATH,
  SESSION_EXPORT_PATH,
  SESSION_IMPORT_PATH,
  SessionAdmin,
} from "@morlay/session-rdb/admin";
import { SESSION_LOG_ARTIFACT_FILENAME } from "@morlay/session-rdb";
import { parseJsonlArtifact } from "@morlay/session-rdb/artifact";
import {
  callRoute,
  fakeConnection,
  fakeRequest,
  fakeResponse,
  fakeWebServer,
  harness,
  meta,
  oneTurnLog,
} from "@morlay/session-rdb/testing";
import { ConversationManagerModule } from "../../conversation-manager/manager.module.ts";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

async function mount() {
  const webServer = fakeWebServer();
  const rdb = await harness({
    providers: [
      ConversationManagerModule,
      { provide: WebServer, useFactory: () => webServer },
      { provide: Connection, useFactory: () => fakeConnection() },
    ],
  });
  disposers.push(() => rdb.app.dispose());
  return { webServer, ...rdb };
}

function unzipBytes(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, entries) => (error === null ? resolve(entries) : reject(error)));
  });
}

describe("管理面端点", () => {
  it("导出返回可解析的 zip，导入把它写回会话", async () => {
    const { webServer, persistence } = await mount();
    await persistence.createAndAppend(meta("exported"), oneTurnLog());

    const exported = fakeExportResponse();
    await callRoute(
      webServer,
      SESSION_EXPORT_PATH,
      fakeRequest("POST", { sessionId: "exported" }),
      exported.res,
    );
    expect(exported.code).toBe(200);
    expect(exported.headers["content-type"]).toBe("application/zip");

    const entries = await unzipBytes(exported.body);
    const artifact = Object.keys(entries)[0];
    expect(artifact).toBeDefined();
    const parsed = parseJsonlArtifact(new TextDecoder().decode(entries[artifact as string]));
    expect(String(parsed.meta.id)).toBe("exported");

    const imported = fakeResponse();
    await callRoute(
      webServer,
      SESSION_IMPORT_PATH,
      fakeRequest("POST", { zip: Buffer.from(exported.body).toString("base64") }),
      imported.res,
    );
    expect(imported.code).toBe(200);
    const created = (JSON.parse(imported.body) as { sessionId: string }).sessionId;
    expect(await persistence.readLog(created as never, {})).toBeDefined();
  });

  it("删除按状态映射：未归档 409、归档后 200、再删 404", async () => {
    const { webServer, persistence } = await mount();
    await persistence.createAndAppend(meta("kept"), oneTurnLog());
    await persistence.createAndAppend(meta("drop"), oneTurnLog());

    const conflict = fakeResponse();
    await callRoute(
      webServer,
      SESSION_DELETE_PATH,
      fakeRequest("POST", { sessionId: "kept" }),
      conflict.res,
    );
    expect(conflict.code).toBe(409);
    expect(JSON.parse(conflict.body).code).toBe("SESSION_NOT_ARCHIVED");

    await persistence.internals().backend.storage.writeWorkspaceState({
      initialized: true,
      workspaceIds: [],
      pinnedSessionIds: [],
      archivedSessionIds: ["drop" as never],
    });
    const ok = fakeResponse();
    await callRoute(
      webServer,
      SESSION_DELETE_PATH,
      fakeRequest("POST", { sessionId: "drop" }),
      ok.res,
    );
    expect(ok.code).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ deleted: "drop" });

    const missing = fakeResponse();
    await callRoute(
      webServer,
      SESSION_DELETE_PATH,
      fakeRequest("POST", { sessionId: "drop" }),
      missing.res,
    );
    expect(missing.code).toBe(404);
  });

  it("导入缺 zip 与删除缺 sessionId 都是 400", async () => {
    const { webServer } = await mount();
    for (const [path, body] of [
      [SESSION_IMPORT_PATH, {}],
      [SESSION_DELETE_PATH, {}],
    ] as const) {
      const response = fakeResponse();
      await callRoute(webServer, path, fakeRequest("POST", body), response.res);
      expect(response.code).toBe(400);
    }
  });
});

interface ZipResponse {
  res: import("node:http").ServerResponse;
  code: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

function fakeExportResponse(): ZipResponse {
  const state = {
    res: undefined as unknown as import("node:http").ServerResponse,
    code: 0,
    headers: {} as Record<string, string>,
    body: new Uint8Array(),
  };
  state.res = {
    writeHead: (code: number, headers?: Record<string, string>) => {
      state.code = code;
      Object.assign(state.headers, headers ?? {});
      return state.res;
    },
    end: (chunk?: Uint8Array | string) => {
      if (chunk !== undefined) {
        state.body =
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
      }
    },
  } as unknown as import("node:http").ServerResponse;
  return state;
}
