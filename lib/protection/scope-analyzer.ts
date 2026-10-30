
import { tokenizeLuau, LuauToken } from "../tokenizer";

export interface IdentifierEdit {
  name: string;
  replacement: string;
  start: number;
  end: number;
}

export interface ScopeAnalysis {
  supported: boolean;
  edits: IdentifierEdit[];
  warnings: string[];
}

const UNSUPPORTED_BLOCKS = new Set([
  "function",
  "if",
  "do",
  "for",
  "while",
  "repeat",
  "end",
  "until",
  "continue",
  "break"
]);

function isBlocked(tokens: LuauToken[]): boolean {
  return tokens.some(token =>
    token.type === "keyword" &&
    UNSUPPORTED_BLOCKS.has(token.value)
  );
}

export function analyzeIdentifiers(
  source: string
): ScopeAnalysis {
  const tokens = tokenizeLuau(source);

  if (isBlocked(tokens)) {
    return {
      supported: false,
      edits: [],
      warnings: [
        "Complex block scopes detected. Identifier transformation skipped safely."
      ]
    };
  }

  const declarations: Array<{
    name: string;
    index: number;
    token: LuauToken;
    equalIndex: number;
  }> = [];

  const warnings: string[] = [];

  // Only process simple local declarations:
  // local name = expression
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (
      token.type !== "keyword" ||
      token.value !== "local"
    ) {
      continue;
    }

    const nameToken = tokens[i + 1];
    const equalToken = tokens[i + 2];

    if (
      !nameToken ||
      nameToken.type !== "identifier" ||
      !equalToken ||
      equalToken.value !== "="
    ) {
      warnings.push(
        "Unsupported local declaration detected."
      );

      continue;
    }

    declarations.push({
      name: nameToken.value,
      index: i,
      token: nameToken,
      equalIndex: i + 2
    });
  }

  const edits: IdentifierEdit[] = [];

  const counts = new Map<string, number>();

  for (const declaration of declarations) {
    counts.set(
      declaration.name,
      (counts.get(declaration.name) ?? 0) + 1
    );
  }

  for (const declaration of declarations) {
    const name = declaration.name;

    if (counts.get(name) !== 1) {
      warnings.push(
        `Identifier '${name}' has multiple declarations and was skipped.`
      );

      continue;
    }

    const lineStart = source.lastIndexOf(
      "\n",
      declaration.token.start
    ) + 1;

    const lineEndResult = source.indexOf(
      "\n",
      declaration.token.end
    );

    const lineEnd = lineEndResult === -1
      ? source.length
      : lineEndResult;

    const declarationLine = source.slice(
      lineStart,
      lineEnd
    );

    const equalPosition = tokens[
      declaration.equalIndex
    ].start;

    const initializer = source.slice(
      equalPosition + 1,
      lineEnd
    );

    const sameLineReference = tokenizeLuau(
      initializer
    ).some(token =>
      token.type === "identifier" &&
      token.value === name
    );

    if (sameLineReference) {
      warnings.push(
        `Identifier '${name}' is used in its initializer and was skipped.`
      );

      continue;
    }

    const previousUse = tokens.some((token, index) =>
      token.type === "identifier" &&
      token.value === name &&
      index < declaration.index
    );

    if (previousUse) {
      warnings.push(
        `Identifier '${name}' is referenced before declaration.`
      );

      continue;
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (
        token.type !== "identifier" ||
        token.value !== name ||
        i < declaration.index + 1
      ) {
        continue;
      }

      const previous = tokens[i - 1];
      const next = tokens[i + 1];

      // Do not rename properties or methods.
      if (
        previous?.value === "." ||
        previous?.value === ":" ||
        next?.value === "=" ||
        next?.value === ":"
      ) {
        continue;
      }

      edits.push({
        name,
        replacement: "",
        start: token.start,
        end: token.end
      });
    }
  }

  return {
    supported: true,
    edits,
    warnings
  };
}
