// 回报指引：中文那份是本部署的默认，名单配了才收窄到指定 preset。
//
// 上游把这段英文文案写在它自己的 `manager.ts` 里、没有替换面；本包不 fork 那 2000 多行，
// 改的是**装配结果**——`agent/pre-step` 上把已认领的那条消息里的英文块换成中文
// （判据见 `packages/agent-ex/session-mode/.agents/designs/20261106-subagent接管面只搬两处文案.md`）。
import type { ContentBlock } from "@morlay/dsh-agent/contract";

// 上游英文指引的起始句：认不出就不动（宁可留英文，也不要注错父 id）。
const UPSTREAM_OPENING = "Your parent agent id is ";

// 起始句之后是父 id 的 JSON 字面量（品牌类型就是字符串，转义形态只有这一种）。
const UPSTREAM_PARENT = /^"((?:[^"\\]|\\.)*)"/u;

// 这个会话要不要用中文那份：名单留空 = 任意会话都用，配了才反过来收窄。
// 入参是本部署那个 preset id（`Config.preset`，默认 `"ptc"`）——本部署没有 roster，没有"组合出来的 preset"。
export function localizedGuidanceApplies(
  preset: string | undefined,
  configured: readonly string[],
): boolean {
  if (configured.length === 0) return true;
  return preset !== undefined && configured.includes(preset);
}

// 中文回报指引：父 id、用什么回报、父看不到什么、回报不结束回合。
export function localizedReturnGuidanceText(parentId: string): string {
  const encodedParentId = JSON.stringify(parentId);
  return (
    `你的父智能体 id 是 ${encodedParentId}。完成前用 send_message({ agent_id: ${encodedParentId}, ` +
    'message: "<自包含的结论>" }) 把结果发给它。父智能体与你共享工作区，但不会自动收到你的对话、' +
    "工具输出与推理过程。发现会改变父智能体下一步行动的事情时也尽早再发一条；发消息不会结束你的回合。"
  );
}

// 把一块上游英文指引换成中文；不是那条就给 `undefined`（调用方据此判定"这条别动"）。
export function rewordReturnGuidance(text: string): string | undefined {
  if (!text.startsWith(UPSTREAM_OPENING)) return undefined;
  const encoded = UPSTREAM_PARENT.exec(text.slice(UPSTREAM_OPENING.length))?.[1];
  if (encoded === undefined) return undefined;
  const parentId = JSON.parse(`"${encoded}"`) as unknown;
  return typeof parentId === "string" ? localizedReturnGuidanceText(parentId) : undefined;
}

// 一条消息的正文里那块英文指引换掉；没命中就给 `undefined`（消息原样保留）。
export function rewordGuidanceContent(
  content: readonly ContentBlock[],
): ContentBlock[] | undefined {
  let changed = false;
  const blocks = content.map((block) => {
    if (block.type !== "text") return block;
    const text = rewordReturnGuidance(block.text);
    if (text === undefined) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? blocks : undefined;
}
