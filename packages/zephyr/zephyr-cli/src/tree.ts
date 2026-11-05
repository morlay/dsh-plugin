// 命令树：把 `app.getAll(Command)` 收到的一批命令按 `path` 摆成树。
//
// 为什么是 path 而不是「父命令注入子命令」：插件只应 provide 自己的命令，**不需要理解树**；
// 树的组装是 CLI 根的事。代价是每个命令多写一行 `path`，换来的是插件与核心之间零约定。
import { Command } from "./command.ts";
import { usageError } from "./errors.ts";

/** 树上的一个节点。 */
export interface CommandNode {
  /** 该位置的命令；虚拟根为 `undefined`。 */
  readonly command?: Command;
  /** 子节点，按注册顺序。 */
  readonly children: readonly CommandNode[];
  /** 从虚拟根到这里的路径段。 */
  readonly path: readonly string[];
}

/** 查表结果。 */
export interface CommandMatch {
  /** 命中的命令。 */
  readonly command: Command;
  /** 没有被命令名消费的实参。 */
  readonly argv: readonly string[];
}

/**
 * 按 `path` 组装命令树。
 *
 * 两条判据都算**装配错误**（不是运行期错误）：同一个 path 被注册两次、父路径没有对应命令。
 * 它们只在「清单拼错了」时发生，早失败才有意义。
 * @param commands - 清单里收集到的全部命令。
 * @returns 虚拟根。
 */
export function buildCommandTree(commands: readonly Command[]): CommandNode {
  const root: MutableNode = { children: [], path: [] };
  for (const command of commands) {
    if (command.path.length === 0) {
      throw usageError(`命令 ${command.constructor.name} 的 path 为空：命令必须落在至少一层路径上`);
    }
    let cursor = root;
    for (const [index, segment] of command.path.entries()) {
      const last = index === command.path.length - 1;
      let next = cursor.children.find((child) => child.path[child.path.length - 1] === segment);
      if (next === undefined) {
        next = { children: [], path: [...cursor.path, segment] };
        cursor.children.push(next);
      }
      if (last) {
        if (next.command !== undefined) {
          throw usageError(
            `命令路径 ${command.path.join(" ")} 重复注册：${next.command.constructor.name} 与 ${command.constructor.name}`,
          );
        }
        next.command = command;
      }
      cursor = next;
    }
  }
  assertParents(root);
  return root;
}

/** 组装期的可变节点（对外只给只读面）。 */
interface MutableNode {
  command?: Command;
  readonly children: MutableNode[];
  readonly path: string[];
}

/**
 * 每个非根节点都必须有命令，否则这个位置只能用来「分组」，而分组在 help 里没有自己的说明。
 * @param node - 待检查的节点。
 */
function assertParents(node: MutableNode): void {
  for (const child of node.children) {
    if (child.command === undefined) {
      throw usageError(
        `命令路径 ${child.path.join(" ")} 没有对应的命令：先注册父命令，再注册 ${child.path.join(" ")} 之下的子命令`,
      );
    }
    assertParents(child);
  }
}

/**
 * 沿实参找命令：尽量多地吃命令名，剩下的都是这个命令的实参。
 * @param tree - 虚拟根。
 * @param argv - 实参。
 * @returns 命中的命令与剩余实参，或 `undefined`（没有匹配的命令）。
 */
export function resolveCommand(
  tree: CommandNode,
  argv: readonly string[],
): CommandMatch | undefined {
  let cursor = tree;
  let matched: CommandNode | undefined = tree;
  let consumed = 0;
  for (const [index, arg] of argv.entries()) {
    const next = cursor.children.find((child) => child.path[child.path.length - 1] === arg);
    if (next === undefined) break;
    cursor = next;
    matched = next;
    consumed = index + 1;
  }
  if (matched?.command === undefined) return undefined;
  return { command: matched.command, argv: argv.slice(consumed) };
}

/**
 * 列出某个位置的子命令名（错误信息与 help 用）。
 * @param node - 节点。
 * @returns 子命令名。
 */
export function childNamesOf(node: CommandNode): readonly string[] {
  return node.children.map((child) => child.path[child.path.length - 1] ?? "").filter(Boolean);
}
