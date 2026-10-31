import { tokenizeLuau, LuauToken } from "../tokenizer";

export interface IdentifierEdit {
  name: string;
  bindingId: number;
  start: number;
  end: number;
  replacement: string;
}

export interface IdentifierAnalysis {
  edits: IdentifierEdit[];
  warnings: string[];
  supported: boolean;
}

interface Binding {
  id: number;
  name: string;
  declarationIndex: number;
  visibleFrom: number;
  scope: Scope;
}

interface Scope {
  id: number;
  start: number;
  end: number;
  parent: Scope | null;
  bindings: Binding[];
}

type BlockKind = "function" | "if" | "loop" | "do" | "repeat";
interface BlockFrame {
  kind: BlockKind;
  scope: Scope;
  branch?: Scope;
  awaitingDo?: boolean;
}

const TYPE_WORDS = new Set([
  "any", "unknown", "never", "nil", "boolean", "number", "string",
  "thread", "userdata", "vector", "true", "false", "typeof",
]);

function isId(token: LuauToken | undefined): token is LuauToken {
  return token?.type === "identifier";
}
function isKw(token: LuauToken | undefined, value: string): boolean {
  return token?.type === "keyword" && token.value === value;
}
function isName(token: LuauToken | undefined, value: string): boolean {
  return token?.value === value;
}

function matchingParen(tokens: LuauToken[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].value === "(") depth++;
    else if (tokens[i].value === ")" && --depth === 0) return i;
  }
  return -1;
}

function isStatementStarter(tokens: LuauToken[], index: number): boolean {
  const token = tokens[index];
  if (!token) return false;
  if (["local", "return", "if", "for", "while", "repeat", "do", "break", "continue"].includes(token.value)) return true;
  if (token.type !== "identifier") return false;
  const next = tokens[index + 1];
  const previous = tokens[index - 1];
  const endsExpression = previous && (
    previous.type === "identifier" || previous.type === "number" ||
    previous.type === "string" || previous.type === "long_string" ||
    [")", "]", "}"].includes(previous.value)
  );
  return Boolean(endsExpression && (next?.value === "(" || next?.value === ":"));
}

function findStatementEnd(tokens: LuauToken[], source: string, start: number): number {
  let round = 0, square = 0, curly = 0, blockDepth = 0;
  for (let i = start; i < tokens.length; i++) {
    const v = tokens[i].value;
    if (i > start && round === 0 && square === 0 && curly === 0 && blockDepth === 0 && isStatementStarter(tokens, i)) return i;
    if (v === "(") round++;
    else if (v === ")") round = Math.max(0, round - 1);
    else if (v === "[") square++;
    else if (v === "]") square = Math.max(0, square - 1);
    else if (v === "{") curly++;
    else if (v === "}") curly = Math.max(0, curly - 1);

    // Multiline function expressions and nested blocks belong to the initializer.
    if (["function", "if", "do", "for", "while", "repeat"].includes(v)) blockDepth++;
    else if (v === "end" || v === "until") blockDepth = Math.max(0, blockDepth - 1);

    if (round || square || curly || blockDepth) continue;
    if (v === ";") return i + 1;
    const next = tokens[i + 1];
    if (!next) return i + 1;
    const gap = source.slice(tokens[i].end, next.start);
    if (/\r?\n/.test(gap) && ![",", ".", ":", "..", "+", "-", "*", "/", "//", "%", "^", "and", "or", "==", "~=", "<", ">", "<=", ">=", "=", "(", "[", "{"].includes(next.value)) return i + 1;
    if (isStatementStarter(tokens, i + 1)) return i + 1;
  }
  return tokens.length;
}

function isPropertyOrKey(tokens: LuauToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  if (previous?.value === "." || previous?.value === ":" || previous?.value === "::") return true;
  if (next?.value === "=" && (previous?.value === "{" || previous?.value === ",")) return true;
  return false;
}

function inTypeContext(tokens: LuauToken[], index: number): boolean {
  // Do not rewrite type aliases, generic declarations, or annotations.
  // A conservative skip is safer than changing a type-level identifier.
  for (let i = index - 1; i >= 0 && index - i < 80; i--) {
    const v = tokens[i].value;
    if (v === "=" || v === ";" || v === "then" || v === "do" || v === "return") return false;
    if (v === "type" || v === "export" || v === "declare") return true;
    if (v === "local" || v === "function") return false;
    if (v === "::") return true;
  }
  return false;
}

export function analyzeIdentifiers(source: string): IdentifierAnalysis {
  let tokens: LuauToken[];
  try {
    tokens = tokenizeLuau(source);
  } catch (error) {
    return { edits: [], warnings: [`Tokenizer rejected source: ${error instanceof Error ? error.message : "unknown error"}`], supported: false };
  }

  const warnings: string[] = [];
  let scopeId = 0;
  let bindingId = 0;
  const root: Scope = { id: scopeId++, start: 0, end: tokens.length, parent: null, bindings: [] };
  const scopes: Scope[] = [root];
  const frames: BlockFrame[] = [];
  const loopScopes = new Map<number, Scope>();
  const tokenScopes: Scope[] = new Array(tokens.length);

  const makeScope = (start: number, parent: Scope): Scope => {
    const scope: Scope = { id: scopeId++, start, end: tokens.length, parent, bindings: [] };
    scopes.push(scope);
    return scope;
  };
  const currentScope = (): Scope => frames.length ? (frames[frames.length - 1].branch ?? frames[frames.length - 1].scope) : root;

  // Build lexical block scopes. Branches of if/elseif/else are siblings.
  for (let i = 0; i < tokens.length; i++) {
    tokenScopes[i] = currentScope();
    const t = tokens[i];
    if (isKw(t, "function")) {
      const s = makeScope(i, currentScope());
      frames.push({ kind: "function", scope: s });
    } else if (isKw(t, "if")) {
      const s = makeScope(i, currentScope());
      frames.push({ kind: "if", scope: s });
    } else if (isKw(t, "for") || isKw(t, "while")) {
      const s = makeScope(i, currentScope());
      if (isKw(t, "for")) loopScopes.set(i, s);
      frames.push({ kind: "loop", scope: s, awaitingDo: true });
    } else if (isKw(t, "repeat")) {
      const s = makeScope(i + 1, currentScope());
      frames.push({ kind: "repeat", scope: s });
    } else if (isKw(t, "then")) {
      const f = [...frames].reverse().find(x => x.kind === "if");
      if (f) f.branch = makeScope(i + 1, f.scope.parent ?? root);
    } else if (isKw(t, "elseif") || isKw(t, "else")) {
      const f = [...frames].reverse().find(x => x.kind === "if");
      if (f) {
        if (f.branch) f.branch.end = i;
        f.branch = isKw(t, "else") ? makeScope(i + 1, f.scope.parent ?? root) : undefined;
      }
    } else if (isKw(t, "do")) {
      const loop = [...frames].reverse().find(x => x.kind === "loop" && x.awaitingDo);
      if (loop) {
        loop.awaitingDo = false;
        loop.scope.start = i + 1;
      } else {
        frames.push({ kind: "do", scope: makeScope(i + 1, currentScope()) });
      }
    } else if (isKw(t, "until")) {
      // Repeat locals remain visible in the until condition.
      const f = frames.pop();
      if (f?.kind === "repeat") f.scope.end = findStatementEnd(tokens, source, i + 1);
      else if (f) frames.push(f);
    } else if (isKw(t, "end")) {
      const f = frames.pop();
      if (!f || f.kind === "repeat") {
        return { edits: [], warnings: [`Unbalanced block near token ${i}; identifier renaming skipped.`], supported: false };
      }
      f.scope.end = i;
      if (f.branch) f.branch.end = i;
    }
  }
  if (frames.length) return { edits: [], warnings: ["Unclosed block; identifier renaming skipped to preserve behavior."], supported: false };

  // Rebuild token-to-scope after all block boundaries are known.
  for (let i = 0; i < tokens.length; i++) {
    let best = root;
    for (const s of scopes) if (s.start <= i && i <= s.end && s.start >= best.start) best = s;
    tokenScopes[i] = best;
  }

  const declarations = new Set<number>();
  const allBindings: Binding[] = [];
  const addBinding = (nameIndex: number, visibleFrom: number, scope: Scope) => {
    const token = tokens[nameIndex];
    if (!isId(token)) return;
    const b: Binding = { id: bindingId++, name: token.value, declarationIndex: nameIndex, visibleFrom, scope };
    scope.bindings.push(b);
    allBindings.push(b);
    declarations.add(nameIndex);
  };

  // Local declarations. Initializer expressions are evaluated before the new locals enter scope.
  for (let i = 0; i < tokens.length; i++) {
    if (!isKw(tokens[i], "local")) continue;
    const scope = tokenScopes[i] ?? root;
    if (isKw(tokens[i + 1], "function")) {
      if (isId(tokens[i + 2])) addBinding(i + 2, i, scope);
      continue;
    }
    let p = i + 1;
    const names: number[] = [];
    while (isId(tokens[p])) {
      names.push(p++);
      if (tokens[p]?.value !== ",") break;
      p++;
    }
    if (!names.length) continue;
    // Luau typed locals: local x: T = value. Keep this binding safe; don't parse type syntax as names.
    if (tokens[p]?.value === ":") {
      const end = findStatementEnd(tokens, source, p + 1);
      for (const n of names) addBinding(n, end, scope);
      warnings.push("Typed local declarations detected; type annotations are preserved.");
      continue;
    }
    const hasInit = tokens[p]?.value === "=";
    const end = hasInit ? findStatementEnd(tokens, source, p + 1) : p;
    for (const n of names) addBinding(n, hasInit ? end : n + 1, scope);
  }

  // Function parameters and implicit self.
  for (let i = 0; i < tokens.length; i++) {
    if (!isKw(tokens[i], "function")) continue;
    let open = i + 1;
    while (open < tokens.length && tokens[open].value !== "(") open++;
    if (open >= tokens.length) continue;
    const close = matchingParen(tokens, open);
    if (close < 0) continue;
    const fnScope = scopes.find(s => s.start === i);
    if (!fnScope) continue;
    const method = tokens[i - 1]?.value === ":";
    if (method) {
      // self is an implicit parameter. Only rewrite references within this method body.
      const firstBody = close + 1;
      const selfToken = tokens.findIndex((t, idx) => idx >= firstBody && idx <= fnScope.end && t.type === "identifier" && t.value === "self");
      if (selfToken >= 0) addBinding(selfToken, fnScope.start, fnScope);
    }
    for (let p = open + 1; p < close; p++) {
      if (isId(tokens[p]) && (p === open + 1 || tokens[p - 1].value === ",")) addBinding(p, fnScope.start, fnScope);
    }
  }

  // Generic and numeric for-loop variables are scoped to the loop body.
  for (let i = 0; i < tokens.length; i++) {
    if (!isKw(tokens[i], "for")) continue;
    const loop = loopScopes.get(i);
    if (!loop) continue;
    let p = i + 1;
    while (p < tokens.length && !isKw(tokens[p], "do")) {
      if (isId(tokens[p]) && (p === i + 1 || tokens[p - 1].value === ",")) addBinding(p, loop.start, loop);
      p++;
    }
  }

  // Resolve each identifier to its nearest visible lexical binding.
  const edits: IdentifierEdit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isId(token) || declarations.has(i) || isPropertyOrKey(tokens, i) || inTypeContext(tokens, i)) continue;
    if (TYPE_WORDS.has(token.value)) continue;
    let scope: Scope | null = tokenScopes[i] ?? root;
    let found: Binding | undefined;
    while (scope) {
      found = scope.bindings
        .filter(b => b.name === token.value && b.visibleFrom <= i)
        .sort((a, b) => b.visibleFrom - a.visibleFrom)[0];
      if (found) break;
      scope = scope.parent;
    }
    if (found) edits.push({ name: found.name, bindingId: found.id, start: token.start, end: token.end, replacement: "" });
  }

  for (const binding of allBindings) {
    const token = tokens[binding.declarationIndex];
    edits.push({ name: binding.name, bindingId: binding.id, start: token.start, end: token.end, replacement: "" });
  }

  // A token can be claimed only once; reject overlapping or duplicate edits.
  const unique = new Map<number, IdentifierEdit>();
  for (const edit of edits) unique.set(edit.start, edit);
  return { edits: [...unique.values()], warnings, supported: true };
}
