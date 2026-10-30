
export type TokenType =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  | "long_string"
  | "operator"
  | "symbol";

export interface LuauToken {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

const KEYWORDS = new Set([
  "and", "break", "continue", "do", "else", "elseif",
  "end", "false", "for", "function", "if", "in",
  "local", "nil", "not", "or", "repeat", "return",
  "then", "true", "until", "while"
]);

const OPERATORS = [
  "...", "..=", "//=", "<<=", ">>=", "==", "~=",
  "<=", ">=", "+=", "-=", "*=", "/=", "%=", "^=",
  "..", "//", "<<", ">>", "::", "->",
  "+", "-", "*", "/", "%", "^", "#",
  "=", "<", ">", "&", "|", "~"
];

const SYMBOLS = new Set([
  "(", ")", "[", "]", "{", "}", ";", ",", ".", ":"
]);

function isAlpha(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function longBracket(
  source: string,
  position: number
): { equals: number; contentStart: number } | null {
  if (source[position] !== "[") return null;

  let i = position + 1;

  while (source[i] === "=") i++;

  if (source[i] !== "[") return null;

  return {
    equals: i - position - 1,
    contentStart: i + 1
  };
}

function readLongString(
  source: string,
  position: number
): number | null {
  const bracket = longBracket(source, position);
  if (!bracket) return null;

  const closing = "]" + "=".repeat(bracket.equals) + "]";
  const end = source.indexOf(closing, bracket.contentStart);

  if (end === -1) return null;

  return end + closing.length;
}

function readNumber(
  source: string,
  position: number
): number {
  const rest = source.slice(position);

  const match = rest.match(
    /^(?:0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?\d+)?|0[bB][01]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/
  );

  return match ? position + match[0].length : position;
}

export function tokenizeLuau(source: string): LuauToken[] {
  const tokens: LuauToken[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Comments
    if (source.startsWith("--", i)) {
      const bracket = longBracket(source, i + 2);

      if (bracket) {
        const end = readLongString(source, i + 2);

        if (end === null) {
          throw new Error(`Unclosed long comment at ${i}`);
        }

        i = end;
      } else {
        const newline = source.indexOf("\n", i);
        i = newline === -1 ? source.length : newline + 1;
      }

      continue;
    }

    // Quoted strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i++;
      let closed = false;

      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }

        if (source[i] === quote) {
          i++;
          closed = true;
          break;
        }

        if (source[i] === "\n" || source[i] === "\r") {
          throw new Error(`Unfinished string at ${start}`);
        }

        i++;
      }

      if (!closed) {
        throw new Error(`Unclosed string at ${start}`);
      }

      tokens.push({
        type: "string",
        value: source.slice(start, i),
        start,
        end: i
      });

      continue;
    }

    // Long strings
    if (ch === "[") {
      const end = readLongString(source, i);

      if (end !== null) {
        const start = i;
        i = end;

        tokens.push({
          type: "long_string",
          value: source.slice(start, end),
          start,
          end
        });

        continue;
      }
    }

    // Identifiers and keywords
    if (isAlpha(ch)) {
      const start = i++;

      while (
        i < source.length &&
        isAlphaNumeric(source[i])
      ) {
        i++;
      }

      const value = source.slice(start, i);

      tokens.push({
        type: KEYWORDS.has(value) ? "keyword" : "identifier",
        value,
        start,
        end: i
      });

      continue;
    }

    // Numbers
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      const start = i;
      const end = readNumber(source, i);

      if (end === i) {
        throw new Error(`Invalid number at ${i}`);
      }

      i = end;

      tokens.push({
        type: "number",
        value: source.slice(start, end),
        start,
        end
      });

      continue;
    }

    // Operators
    const operator = OPERATORS.find(op =>
      source.startsWith(op, i)
    );

    if (operator) {
      const start = i;
      i += operator.length;

      tokens.push({
        type: "operator",
        value: operator,
        start,
        end: i
      });

      continue;
    }

    // Symbols
    if (SYMBOLS.has(ch)) {
      tokens.push({
        type: "symbol",
        value: ch,
        start: i,
        end: i + 1
      });

      i++;
      continue;
    }

    throw new Error(
      `Unknown character '${ch}' at position ${i}`
    );
  }

  return tokens;
}
