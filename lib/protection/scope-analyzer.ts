
import { tokenizeLuau } from "../tokenizer";

export interface ScopeDeclaration {
  name: string;
  tokenIndex: number;
  start: number;
  end: number;
  scopeId: number;
  kind: "local" | "parameter" | "loop";
  references: number[];
}

export interface ScopeAnalysisResult {
  declarations: ScopeDeclaration[];
  warnings: string[];
  safe: boolean;
}

interface Token {
  type: string;
  value: string;
  start: number;
  end: number;
}

interface Scope {
  id: number;
  parent: number | null;
  declarations: Map<string, ScopeDeclaration>;
}

const BLOCK_OPENERS = new Set([
  "function",
  "if",
  "do",
  "while",
  "for",
  "repeat",
]);

const BLOCK_CLOSERS = new Set([
  "end",
  "until",
]);

const CONTROL_KEYWORDS = new Set([
  "and", "break", "continue", "do", "else", "elseif",
  "end", "false", "for", "function", "if", "in",
  "local", "nil", "not", "or", "repeat", "return",
  "then", "true", "until", "while",
]);

const UNSUPPORTED_KEYWORDS = new Set([
  "export",
  "type",
  "declare",
]);

function isIdentifier(token?: Token): boolean {
  return token?.type === "identifier";
}

function isSymbol(token: Token | undefined, value: string): boolean {
  return token?.value === value;
}

function isKeyword(token: Token | undefined, value: string): boolean {
  return token?.type === "keyword" && token.value === value;
}

function isPropertyName(
  tokens: Token[],
  index: number,
): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];

  // object.name
  if (
    previous &&
    (previous.value === "." || previous.value === ":")
  ) {
    return true;
  }

  // { name = value }
  if (
    next?.value === "=" &&
    previous &&
    (previous.value === "{" || previous.value === ",")
  ) {
    return true;
  }

  return false;
}

function createScope(
  id: number,
  parent: number | null,
): Scope {
  return {
    id,
    parent,
    declarations: new Map(),
  };
}

export function analyzeScopes(
  source: string,
): ScopeAnalysisResult {
  const tokens = tokenizeLuau(source) as Token[];

  const warnings: string[] = [];
  const declarations: ScopeDeclaration[] = [];

  const scopes: Scope[] = [
    createScope(0, null),
  ];

  let currentScope = 0;
  let nextScopeId = 1;

  const scopeStack: number[] = [0];

  const declarationIndexes = new Set<number>();
  const ignoredIndexes = new Set<number>();

  function getCurrentScope(): Scope {
    return scopes[currentScope];
  }

  function pushScope(): void {
    const scope = createScope(
      nextScopeId++,
      currentScope,
    );

    scopes.push(scope);
    currentScope = scope.id;
    scopeStack.push(scope.id);
  }

  function popScope(): void {
    if (scopeStack.length <= 1) {
      warnings.push("Unexpected block terminator.");
      return;
    }

    scopeStack.pop();
    currentScope = scopeStack[scopeStack.length - 1];
  }

  function findDeclaration(
    name: string,
    scopeId: number,
  ): ScopeDeclaration | undefined {
    let scope = scopes[scopeId];

    while (scope) {
      const declaration = scope.declarations.get(name);

      if (declaration) {
        return declaration;
      }

      if (scope.parent === null) {
        break;
      }

      scope = scopes[scope.parent];
    }

    return undefined;
  }

  function addDeclaration(
    index: number,
    kind: ScopeDeclaration["kind"],
  ): void {
    const token = tokens[index];

    if (!isIdentifier(token)) {
      warnings.push(
        `Invalid ${kind} declaration near token ${index}.`,
      );
      return;
    }

    const scope = getCurrentScope();

    if (scope.declarations.has(token.value)) {
      warnings.push(
        `Duplicate local declaration: ${token.value}.`,
      );
      return;
    }

    const declaration: ScopeDeclaration = {
      name: token.value,
      tokenIndex: index,
      start: token.start,
      end: token.end,
      scopeId: currentScope,
      kind,
      references: [],
    };

    scope.declarations.set(token.value, declaration);
    declarations.push(declaration);
    declarationIndexes.add(index);
  }

  function findMatching(
    start: number,
    open: string,
    close: string,
  ): number {
    let depth = 0;

    for (let i = start; i < tokens.length; i++) {
      if (tokens[i].value === open) {
        depth++;
      } else if (tokens[i].value === close) {
        depth--;

        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  // Pass 1: identify unsupported syntax.
  for (const token of tokens) {
    if (
      token.type === "keyword" &&
      UNSUPPORTED_KEYWORDS.has(token.value)
    ) {
      warnings.push(
        `Unsupported Luau syntax: ${token.value}.`,
      );
    }
  }

  if (warnings.length > 0) {
    return {
      declarations: [],
      warnings,
      safe: false,
    };
  }

  // Pass 2: identify local declarations and block scopes.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    // local function name(...)
    if (
      isKeyword(token, "local") &&
      isKeyword(next, "function")
    ) {
      if (!isIdentifier(tokens[i + 2])) {
        warnings.push("Invalid local function declaration.");
        break;
      }

      addDeclaration(i + 2, "local");
      ignoredIndexes.add(i + 2);

      // Function body starts after its parameter list.
      let open = i + 3;

      while (open < tokens.length && tokens[open].value !== "(") {
        open++;
      }

      if (open >= tokens.length) {
        warnings.push("Missing function parameter list.");
        break;
      }

      const close = findMatching(open, "(", ")");

      if (close === -1) {
        warnings.push("Unclosed function parameter list.");
        break;
      }

      pushScope();

      for (let p = open + 1; p < close; p++) {
        if (isIdentifier(tokens[p])) {
          const previous = tokens[p - 1];

          if (
            p === open + 1 ||
            previous?.value === ","
          ) {
            addDeclaration(p, "parameter");
          }
        }
      }

      continue;
    }

    // function name(...) or function(...)
    if (isKeyword(token, "function")) {
      let open = i + 1;

      while (open < tokens.length && tokens[open].value !== "(") {
        open++;
      }

      if (open >= tokens.length) {
        warnings.push("Missing function parameter list.");
        break;
      }

      const close = findMatching(open, "(", ")");

      if (close === -1) {
        warnings.push("Unclosed function parameter list.");
        break;
      }

      pushScope();

      for (let p = open + 1; p < close; p++) {
        if (
          isIdentifier(tokens[p]) &&
          (p === open + 1 || tokens[p - 1].value === ",")
        ) {
          addDeclaration(p, "parameter");
        }
      }

      continue;
    }

    // local a, b, c
    if (isKeyword(token, "local")) {
      let p = i + 1;

      while (p < tokens.length) {
        if (!isIdentifier(tokens[p])) {
          break;
        }

        addDeclaration(p, "local");
        p++;

        if (tokens[p]?.value !== ",") {
          break;
        }

        p++;
      }

      continue;
    }

    // for i = ... or for k, v in ...
    if (isKeyword(token, "for")) {
      let p = i + 1;
      const loopNames: number[] = [];

      while (p < tokens.length && isIdentifier(tokens[p])) {
        loopNames.push(p);
        p++;

        if (tokens[p]?.value !== ",") {
          break;
        }

        p++;
      }

      if (loopNames.length > 0) {
        pushScope();

        for (const index of loopNames) {
          addDeclaration(index, "loop");
        }
      }

      continue;
    }

    // Blocks
    if (
      BLOCK_OPENERS.has(token.value) &&
      token.value !== "function" &&
      token.value !== "for"
    ) {
      pushScope();
      continue;
    }

    if (BLOCK_CLOSERS.has(token.value)) {
      popScope();
    }
  }

  if (warnings.length > 0) {
    return {
      declarations: [],
      warnings,
      safe: false,
    };
  }

  // Pass 3: resolve identifier references.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (
      !isIdentifier(token) ||
      declarationIndexes.has(i) ||
      ignoredIndexes.has(i) ||
      isPropertyName(tokens, i)
    ) {
      continue;
    }

    if (CONTROL_KEYWORDS.has(token.value)) {
      continue;
    }

    const declaration = findDeclaration(
      token.value,
      currentScope,
    );

    if (declaration) {
      declaration.references.push(i);
    }
  }

  return {
    declarations,
    warnings,
    safe: true,
  };
}
