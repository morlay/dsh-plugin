import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type { FileReference } from "./links.ts";

// 与 `@deepseek-ai/dsh-tool-fs` 的 read 默认一致：同一份文件在 read 与注入两条路上看到同一个窗口。
const READ_LIMIT = 2000;

const READ_MAX_LINE_LENGTH = 2000;

const READ_MAX_BYTES = 50 * 1024;

const STREAM_MIN_SIZE = 10 * 1024 * 1024;

interface Line {
  readonly number: number;
  readonly text: string;
}

interface Window {
  readonly lines: readonly Line[];
  readonly totalLines: number;
  readonly truncatedByBytes: boolean;
}

export interface FileReadRequest {
  readonly cwd: string | undefined;
  readonly signal: AbortSignal;
}

// 读不出「存在且是普通文本文件」就返回 undefined：引用保持普通文本，本步照常进行。
export async function readFileContent(
  fs: FileSystem,
  reference: FileReference,
  request: FileReadRequest,
): Promise<string | undefined> {
  const offset = reference.lineStart ?? 1;
  const limit =
    reference.lineEnd === undefined ? READ_LIMIT : Math.max(1, reference.lineEnd - offset + 1);
  try {
    const target = await fs.resolve(reference.path, {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      signal: request.signal,
    });
    const info = await fs.stat(target, request.signal);
    if (info === undefined || info.type !== "file") return undefined;
    const chunks =
      info.size === undefined || info.size >= STREAM_MIN_SIZE
        ? await fs.streamText(target, request.signal)
        : [await fs.readText(target, request.signal)];
    const window = await buildWindow(chunks, { offset, limit });
    if (window === undefined) return undefined;
    return formatReadOutput(target.displayPath, {
      offset,
      lines: window.lines,
      totalLines: window.totalLines,
      truncatedByBytes: window.truncatedByBytes,
    });
  } catch {
    request.signal.throwIfAborted();
    return undefined;
  }
}

// 与 read 的窗口语义同构：扫到文件末尾拿准确总行数，只保留窗口内的行，字节/单行上限到顶就停。
async function buildWindow(
  chunks: AsyncIterable<string> | Iterable<string>,
  window: { readonly offset: number; readonly limit: number },
): Promise<Window | undefined> {
  const lines: Line[] = [];
  let totalLines = 0;
  let outputBytes = 0;
  let truncatedByBytes = false;
  let lineBuffer = "";
  const lineBufferCap = READ_MAX_LINE_LENGTH + 1;

  const append = (segment: string): void => {
    if (lineBuffer.length >= lineBufferCap) return;
    lineBuffer += segment;
    if (lineBuffer.length > lineBufferCap) lineBuffer = lineBuffer.slice(0, lineBufferCap);
  };

  const flush = (): void => {
    const raw = lineBuffer.endsWith("\r") ? lineBuffer.slice(0, -1) : lineBuffer;
    lineBuffer = "";
    totalLines += 1;
    if (truncatedByBytes || totalLines < window.offset || lines.length >= window.limit) return;
    const text =
      raw.length > READ_MAX_LINE_LENGTH
        ? `${raw.slice(0, READ_MAX_LINE_LENGTH)}... (line truncated to ${READ_MAX_LINE_LENGTH} chars)`
        : raw;
    const bytes = Buffer.byteLength(text, "utf8") + (lines.length > 0 ? 1 : 0);
    if (outputBytes + bytes > READ_MAX_BYTES) {
      truncatedByBytes = true;
      return;
    }
    outputBytes += bytes;
    lines.push({ number: totalLines, text });
  };

  for await (const chunk of chunks) {
    let start = 0;
    let newline = chunk.indexOf("\n", start);
    while (newline !== -1) {
      append(chunk.slice(start, newline));
      flush();
      start = newline + 1;
      newline = chunk.indexOf("\n", start);
    }
    append(chunk.slice(start));
  }
  if (lineBuffer.length > 0) flush();

  const beyondEof =
    !truncatedByBytes && window.offset > totalLines && !(totalLines === 0 && window.offset === 1);
  if (beyondEof) return undefined;
  return { lines, totalLines, truncatedByBytes };
}

// 逐字对齐 read 工具信封：同一个 `<path>/<type>/<content>` 文本、同一句续读提示。
function formatReadOutput(
  displayPath: string,
  outcome: {
    readonly offset: number;
    readonly lines: readonly Line[];
    readonly totalLines: number;
    readonly truncatedByBytes: boolean;
  },
): string {
  const endLine = outcome.lines.at(-1)?.number ?? Math.max(0, outcome.offset - 1);
  let footer: string;
  if (outcome.truncatedByBytes) {
    footer = `(Output capped. Showing lines ${outcome.offset}-${endLine}. Use offset=${endLine + 1} to continue.)`;
  } else if (endLine < outcome.totalLines) {
    footer = `(Showing lines ${outcome.offset}-${endLine} of ${outcome.totalLines}. Use offset=${endLine + 1} to continue.)`;
  } else {
    footer = `(End of file - total ${outcome.totalLines} lines)`;
  }
  const body =
    outcome.lines.length === 0
      ? footer
      : `${outcome.lines.map((line) => `${line.number}: ${line.text}`).join("\n")}\n\n${footer}`;
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${body}
</content>`;
}
