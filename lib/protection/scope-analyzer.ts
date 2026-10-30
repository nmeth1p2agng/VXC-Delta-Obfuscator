
import { tokenizeLuau } from "../tokenizer";

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

const COMPLEX_KEYWORDS = new Set([
  "function",
  "if",
  "then",
  "else",
  "elseif",
  "end",
  "for",
  "while",
  "repeat",
  "until",
  "do",
  "continue",
  "break",
  "export",
  "type",
  "declare",
]);

function isIdentifier(token: any): boolean {
  return token?.type === "identifier";
}

function isKeyword(token: any, value: string): boolean {
  return token?.type === "keyword" && token.value === value;
}

function isPropertyOrTableKey(
  tokens: any[],
  index: number,
): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];

  if (
    previous &&
    (previous.value === "." || previous.value === ":")
  ) {
    return true;
  }

  if (
    next?.value === "=" &&
    previous &&
    (previous.value === "{" || previous.value === ",")
  ) {
    return true;
  }

  return false;
}

export function analyzeIdentifiers(
  source: string,
): IdentifierAnalysis {
  const tokens = tokenizeLuau(source);

  const warnings: string[] = [];
  const edits: IdentifierEdit[] = [];

  const declarations = new Map<
    string,
    { index: number; start: number; end: number }
  >();

  const declarationIndexes = new Set<number>();

  // Lewati sintaks kompleks yang belum didukung.
  for (const token of tokens) {
    if (
      token.type === "keyword" &&
      COMPLEX_KEYWORDS.has(token.value)
    ) {
      return {
        edits: [],
        warnings: [
          `Identifier protection skipped: unsupported scope syntax "${token.value}".`,
        ],
        supported: false,
      };
    }
  }

  // Analisis deklarasi local sederhana.
  for (let i = 0; i < tokens.length; i++) {
    if (!isKeyword(tokens[i], "local")) {
      continue;
    }

    let index = i + 1;
    const localIndexes: number[] = [];

    while (index < tokens.length) {
      if (!isIdentifier(tokens[index])) {
        break;
      }

      localIndexes.push(index);
      index++;

      if (tokens[index]?.value !== ",") {
        break;
      }

      index++;
    }

    if (localIndexes.length === 0) {
      continue;
    }

    if (tokens[index]?.value !== "=") {
      return {
        edits: [],
        warnings: [
          "Identifier protection skipped: unsupported local declaration.",
        ],
        supported: false,
      };
    }

    for (const declarationIndex of localIndexes) {
      const token = tokens[declarationIndex];
      const name = token.value;

      if (declarations.has(name)) {
        return {
          edits: [],
          warnings: [
            `Identifier protection skipped: duplicate local "${name}".`,
          ],
          supported: false,
        };
      }

      declarations.set(name, {
        index: declarationIndex,
        start: token.start,
        end: token.end,
      });

      declarationIndexes.add(declarationIndex);
    }
  }

  if (declarations.size === 0) {
    return {
      edits: [],
      warnings,
      supported: true,
    };
  }

  // Pastikan tidak ada referensi sebelum deklarasi.
  for (const [name, declaration] of declarations) {
    for (let i = 0; i < declaration.index; i++) {
      const token = tokens[i];

      if (
        isIdentifier(token) &&
        token.value === name &&
        !isPropertyOrTableKey(tokens, i)
      ) {
        return {
          edits: [],
          warnings: [
            `Identifier protection skipped: "${name}" is referenced before declaration.`,
          ],
          supported: false,
        };
      }
    }
  }

  // Tambahkan edit untuk deklarasi.
  for (const [name, declaration] of declarations) {
    edits.push({
      name,
      start: declaration.start,
      end: declaration.end,
      replacement: "",
    });
  }

  // Tambahkan edit untuk referensi.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (
      !isIdentifier(token) ||
      declarationIndexes.has(i) ||
      isPropertyOrTableKey(tokens, i)
    ) {
      continue;
    }

    const declaration = declarations.get(token.value);

    if (!declaration || i <= declaration.index) {
      continue;
    }

    edits.push({
      name: token.value,
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
