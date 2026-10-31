
import { tokenizeLuau, LuauToken } from "../tokenizer";

export interface IdentifierEdit {
  name: string;
  start: number;
  end: number;
  replacement: string;
}

export interface IdentifierAnalysis {
  edits: IdentifierEdit[];
  warnings: string[];
  supported: boolean;
}

interface Scope {
  id: number;
  start: number;
  end: number;
  parent: Scope | null;
  declarations: Declaration[];
}

interface Declaration {
  name: string;
  tokenIndex: number;
  startIndex: number;
  scope: Scope;
}

interface BlockFrame {
  kind: "function" | "if" | "do" | "repeat" | "loop";
  scope: Scope;
  branchScope?: Scope;
  awaitingDo?: boolean;
}

const CONTROL_CONTINUATIONS = new Set([
  "+", "-", "*", "/", "//", "%", "^", "..", "and", "or",
  "==", "~=", "<", ">", "<=", ">=", "=", ",", ".", ":",
  "(", "[", "{", "then", "do", "in",
]);

function isIdentifier(token?: LuauToken): boolean {
  return token?.type === "identifier";
}

function isKeyword(token: LuauToken | undefined, value: string): boolean {
  return token?.type === "keyword" && token.value === value;
}

function isPropertyOrKey(tokens: LuauToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];

  if (previous?.value === "." || previous?.value === ":") {
    return true;
  }

  if (
    next?.value === "=" &&
    (previous?.value === "{" || previous?.value === ",")
  ) {
    return true;
  }

  return false;
}

function matchingParen(tokens: LuauToken[], open: number): number {
  let depth = 0;

  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].value === "(") {
      depth++;
    } else if (tokens[i].value === ")") {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function createScope(
  id: number,
  start: number,
  parent: Scope | null,
): Scope {
  return {
    id,
    start,
    end: Number.MAX_SAFE_INTEGER,
    parent,
    declarations: [],
  };
}

function findInnermostScope(
  scopes: Scope[],
  index: number,
): Scope {
  let best = scopes[0];

  for (const scope of scopes) {
    if (
      scope.start <= index &&
      index <= scope.end &&
      scope.start >= best.start
    ) {
      best = scope;
    }
  }

  return best;
}

function statementEnd(
  tokens: LuauToken[],
  source: string,
  start: number,
): number {
  let round = 0;
  let square = 0;
  let curly = 0;

  for (let i = start; i < tokens.length; i++) {
    const value = tokens[i].value;

    if (value === "(") round++;
    else if (value === ")") round = Math.max(0, round - 1);
    else if (value === "[") square++;
    else if (value === "]") square = Math.max(0, square - 1);
    else if (value === "{") curly++;
    else if (value === "}") curly = Math.max(0, curly - 1);

    if (round === 0 && square === 0 && curly === 0) {
      if (value === ";") return i + 1;

      const next = tokens[i + 1];

      if (!next) return i + 1;

      const between = source.slice(
        tokens[i].end,
        next.start,
      );

      if (
        /\r?\n/.test(between) &&
        !CONTROL_CONTINUATIONS.has(next.value)
      ) {
        return i + 1;
      }

      if (
        ["end", "else", "elseif", "until"].includes(next.value)
      ) {
        return i + 1;
      }
    }
  }

  return tokens.length;
}

export function analyzeIdentifiers(
  source: string,
): IdentifierAnalysis {
  let tokens: LuauToken[];

  try {
    tokens = tokenizeLuau(source);
  } catch (error) {
    return {
      edits: [],
      warnings: [
        `Identifier analysis skipped: ${(error as Error).message}`,
      ],
      supported: false,
    };
  }

  const root = createScope(0, 0, null);
  const scopes: Scope[] = [root];
  const frames: BlockFrame[] = [];

  let nextScopeId = 1;

  const warnings: string[] = [];

  const openScope = (
    start: number,
    parent?: Scope,
  ): Scope => {
    const scope = createScope(
      nextScopeId++,
      start,
      parent ?? findInnermostScope(scopes, start),
    );

    scopes.push(scope);

    return scope;
  };

  // PASS 1: BUILD BLOCK SCOPES

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (isKeyword(token, "function")) {
      const scope = openScope(i + 1);

      frames.push({
        kind: "function",
        scope,
      });

      continue;
    }

    if (isKeyword(token, "if")) {
      const scope = openScope(i + 1);

      frames.push({
        kind: "if",
        scope,
      });

      continue;
    }

    if (
      isKeyword(token, "for") ||
      isKeyword(token, "while")
    ) {
      const scope = openScope(i + 1);

      frames.push({
        kind: "loop",
        scope,
        awaitingDo: true,
      });

      continue;
    }

    if (isKeyword(token, "repeat")) {
      const scope = openScope(i + 1);

      frames.push({
        kind: "repeat",
        scope,
      });

      continue;
    }

    if (isKeyword(token, "then")) {
      const frame = [...frames]
        .reverse()
        .find((item) => item.kind === "if");

      if (frame) {
        frame.branchScope = openScope(
          i + 1,
          frame.scope,
        );
      }

      continue;
    }

    if (
      isKeyword(token, "elseif") ||
      isKeyword(token, "else")
    ) {
      const frame = [...frames]
        .reverse()
        .find((item) => item.kind === "if");

      if (frame?.branchScope) {
        frame.branchScope.end = i;
        frame.branchScope = undefined;
      }

      if (isKeyword(token, "else") && frame) {
        frame.branchScope = openScope(
          i + 1,
          frame.scope,
        );
      }

      continue;
    }

    if (isKeyword(token, "do")) {
      const loop = [...frames]
        .reverse()
        .find(
          (item) =>
            item.kind === "loop" &&
            item.awaitingDo,
        );

      if (loop) {
        loop.awaitingDo = false;
        loop.scope.start = i + 1;
      } else {
        const scope = openScope(i + 1);

        frames.push({
          kind: "do",
          scope,
        });
      }

      continue;
    }

    if (isKeyword(token, "until")) {
      const frame = frames.pop();

      if (frame?.kind === "repeat") {
        frame.scope.end = i;
      } else if (frame) {
        frames.push(frame);
      }

      continue;
    }

    if (isKeyword(token, "end")) {
      const frame = frames.pop();

      if (!frame) {
        return {
          edits: [],
          warnings: [
            "Identifier protection skipped: unmatched end keyword.",
          ],
          supported: false,
        };
      }

      frame.scope.end = i;

      if (frame.branchScope) {
        frame.branchScope.end = i;
      }
    }
  }

  if (frames.length > 0) {
    return {
      edits: [],
      warnings: [
        "Identifier protection skipped: unmatched Luau block.",
      ],
      supported: false,
    };
  }

  root.end = tokens.length;

  // PASS 2: COLLECT DECLARATIONS

  const declarations: Declaration[] = [];

  const addDeclaration = (
    nameIndex: number,
    visibleFrom: number,
    scope: Scope,
  ) => {
    const token = tokens[nameIndex];

    if (!isIdentifier(token)) return;

    const declaration: Declaration = {
      name: token.value,
      tokenIndex: nameIndex,
      startIndex: visibleFrom,
      scope,
    };

    scope.declarations.push(declaration);
    declarations.push(declaration);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // LOCAL FUNCTION

    if (isKeyword(token, "local")) {
      if (isKeyword(tokens[i + 1], "function")) {
        const nameIndex = i + 2;
        const scope = findInnermostScope(scopes, i);

        addDeclaration(nameIndex, i, scope);

        continue;
      }

      // LOCAL VARIABLES

      const names: number[] = [];

      let cursor = i + 1;

      while (isIdentifier(tokens[cursor])) {
        names.push(cursor++);

        if (tokens[cursor]?.value !== ",") {
          break;
        }

        cursor++;
      }

      if (names.length === 0) continue;

      const hasInitializer =
        tokens[cursor]?.value === "=";

      const end = hasInitializer
        ? statementEnd(tokens, source, cursor + 1)
        : cursor;

      const rhsStart = hasInitializer
        ? tokens[cursor].end
        : tokens[names[names.length - 1]].end;

      const rhsEnd =
        hasInitializer && end > cursor + 1
          ? tokens[end - 1].end
          : rhsStart;

      const rhsText = source.slice(rhsStart, rhsEnd);

      const multiline =
        /\r?\n/.test(rhsText) && hasInitializer;

      const scope = findInnermostScope(scopes, i);

      if (multiline) {
        warnings.push(
          "A multiline local initializer was left unchanged for safety.",
        );
      } else {
        const visibleFrom = hasInitializer
          ? end
          : names[names.length - 1] + 1;

        for (const nameIndex of names) {
          addDeclaration(
            nameIndex,
            visibleFrom,
            scope,
          );
        }
      }

      continue;
    }

    // FUNCTION PARAMETERS

    if (isKeyword(token, "function")) {
      let open = i + 1;

      while (
        open < tokens.length &&
        tokens[open].value !== "("
      ) {
        open++;
      }

      if (open >= tokens.length) continue;

      const close = matchingParen(tokens, open);

      if (close < 0) continue;

      const functionScope = scopes.find(
        (scope) =>
          scope.start === i + 1 &&
          scope !== root,
      );

      if (!functionScope) continue;

      // IMPLICIT SELF FOR COLON METHODS

      const methodNameIndex = i - 1;

      if (
        tokens[methodNameIndex]?.type === "identifier" &&
        tokens[methodNameIndex - 1]?.value === ":"
      ) {
        for (
          let p = close + 1;
          p < functionScope.end;
          p++
        ) {
          if (
            isIdentifier(tokens[p]) &&
            tokens[p].value === "self"
          ) {
            addDeclaration(
              p,
              functionScope.start,
              functionScope,
            );

            break;
          }
        }
      }

      for (let p = open + 1; p < close; p++) {
        if (
          isIdentifier(tokens[p]) &&
          (
            p === open + 1 ||
            tokens[p - 1].value === ","
          )
        ) {
          addDeclaration(
            p,
            functionScope.start,
            functionScope,
          );
        }
      }
    }

    // FOR LOOP VARIABLES

    if (isKeyword(token, "for")) {
      const scope = [...scopes]
        .filter(
          (item) =>
            item !== root &&
            item.start >= i + 1,
        )
        .sort((a, b) => a.start - b.start)[0];

      if (!scope) continue;

      let cursor = i + 1;

      while (isIdentifier(tokens[cursor])) {
        addDeclaration(
          cursor,
          scope.start,
          scope,
        );

        cursor++;

        if (tokens[cursor]?.value !== ",") {
          break;
        }

        cursor++;
      }
    }
  }

  // PASS 3: RESOLVE IDENTIFIER REFERENCES

  const edits: IdentifierEdit[] = [];

  const declarationIndexes = new Set(
    declarations.map((item) => item.tokenIndex),
  );

  const resolved = new Map<number, Declaration>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (
      !isIdentifier(token) ||
      declarationIndexes.has(i) ||
      isPropertyOrKey(tokens, i)
    ) {
      continue;
    }

    let scope: Scope | null =
      findInnermostScope(scopes, i);

    let match: Declaration | undefined;

    while (scope) {
      match = scope.declarations
        .filter(
          (item) =>
            item.name === token.value &&
            item.startIndex <= i,
        )
        .sort(
          (a, b) =>
            b.startIndex - a.startIndex,
        )[0];

      if (match) break;

      scope = scope.parent;
    }

    if (match) {
      resolved.set(i, match);
    }
  }

  // PASS 4: GENERATE SOURCE EDITS

  for (const declaration of declarations) {
    const token = tokens[declaration.tokenIndex];

    edits.push({
      name: declaration.name,
      start: token.start,
      end: token.end,
      replacement: "",
    });
  }

  for (const [index, declaration] of resolved) {
    const token = tokens[index];

    edits.push({
      name: declaration.name,
      start: token.start,
      end: token.end,
      replacement: "",
    });
  }

  return {
    edits,
    warnings,
    supported: true,
  };
}
