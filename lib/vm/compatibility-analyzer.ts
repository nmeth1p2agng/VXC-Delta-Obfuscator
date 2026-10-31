
import { tokenizeLuau, type LuauToken } from "../tokenizer";

export type CompatibilityLevel =
  | "vm-supported"
  | "partially-supported"
  | "unsupported";

export interface CompatibilityIssue {
  code: string;
  message: string;
  position: number;
  severity: "warning" | "error";
}

export interface LuauCompatibilityReport {
  success: boolean;
  structurallyValid: boolean;
  vmSupported: boolean;
  level: CompatibilityLevel;
  tokenCount: number;
  features: string[];
  unsupportedFeatures: string[];
  issues: CompatibilityIssue[];
}

interface BlockEntry {
  type: string;
  position: number;
  awaitingDo?: boolean;
}

const BLOCK_OPENERS = new Set([
  "function",
  "if",
  "for",
  "while",
  "repeat",
]);

const VM_KEYWORDS = new Set([
  "local",
  "return",
  "true",
  "false",
  "nil",
]);

const VM_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "=",
]);

const VM_SYMBOLS = new Set([
  "(",
  ")",
  ";",
  ",",
]);

const FEATURE_PATTERNS: Array<{
  name: string;
  detect: (tokens: LuauToken[]) => boolean;
}> = [
  {
    name: "functions",
    detect: tokens => tokens.some(t => t.value === "function"),
  },
  {
    name: "loops",
    detect: tokens =>
      tokens.some(t =>
        ["for", "while", "repeat", "until", "break", "continue"].includes(t.value)
      ),
  },
  {
    name: "conditionals",
    detect: tokens =>
      tokens.some(t =>
        ["if", "then", "elseif", "else"].includes(t.value)
      ),
  },
  {
    name: "tables",
    detect: tokens =>
      tokens.some(t => ["{", "}"].includes(t.value)),
  },
  {
    name: "member-access",
    detect: tokens =>
      tokens.some(t => t.value === "." || t.value === ":"),
  },
  {
    name: "indexing",
    detect: tokens =>
      tokens.some(t => t.value === "[" || t.value === "]"),
  },
  {
    name: "method-calls",
    detect: tokens =>
      tokens.some((t, i) =>
        t.value === ":" &&
        tokens[i + 1]?.type === "identifier"
      ),
  },
  {
    name: "type-syntax",
    detect: tokens =>
      tokens.some(t =>
        ["::", "->"].includes(t.value) ||
        (t.type === "identifier" && t.value === "type")
      ),
  },
  {
    name: "compound-assignment",
    detect: tokens =>
      tokens.some(t =>
        ["+=", "-=", "*=", "/=", "%=", "^=", "..="].includes(t.value)
      ),
  },
  {
    name: "coroutines",
    detect: tokens =>
      tokens.some(t =>
        ["task", "coroutine"].includes(t.value)
      ),
  },
  {
    name: "error-handling",
    detect: tokens =>
      tokens.some(t => t.value === "pcall" || t.value === "xpcall"),
  },
  {
    name: "dynamic-loading",
    detect: tokens =>
      tokens.some(t => t.value === "require" || t.value === "loadstring"),
  },
  {
    name: "varargs",
    detect: tokens =>
      tokens.some(t => t.value === "..."),
  },
];

function addIssue(
  issues: CompatibilityIssue[],
  code: string,
  message: string,
  position: number,
  severity: "warning" | "error"
): void {
  issues.push({
    code,
    message,
    position,
    severity,
  });
}

function validateDelimiters(
  tokens: LuauToken[],
  issues: CompatibilityIssue[]
): boolean {
  const stack: LuauToken[] = [];

  const closing: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{",
  };

  for (const token of tokens) {
    if (["(", "[", "{"].includes(token.value)) {
      stack.push(token);
      continue;
    }

    if (closing[token.value]) {
      const previous = stack.pop();

      if (!previous || previous.value !== closing[token.value]) {
        addIssue(
          issues,
          "UNMATCHED_DELIMITER",
          `Unmatched closing delimiter '${token.value}'.`,
          token.start,
          "error"
        );

        return false;
      }
    }
  }

  if (stack.length > 0) {
    const token = stack[stack.length - 1];

    addIssue(
      issues,
      "UNCLOSED_DELIMITER",
      `Unclosed delimiter '${token.value}'.`,
      token.start,
      "error"
    );

    return false;
  }

  return true;
}

function validateBlocks(
  tokens: LuauToken[],
  issues: CompatibilityIssue[]
): boolean {
  const stack: BlockEntry[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const value = token.value;

    if (BLOCK_OPENERS.has(value)) {
      stack.push({
        type: value,
        position: token.start,
        awaitingDo: value === "for" || value === "while",
      });

      continue;
    }

    if (value === "do") {
      const top = stack[stack.length - 1];

      if (top && top.awaitingDo) {
        top.awaitingDo = false;
      } else {
        stack.push({
          type: "do",
          position: token.start,
        });
      }

      continue;
    }

    if (value === "end") {
      const top = stack.pop();

      if (!top || top.type === "repeat") {
        addIssue(
          issues,
          "UNEXPECTED_END",
          "Unexpected 'end' keyword.",
          token.start,
          "error"
        );

        return false;
      }

      continue;
    }

    if (value === "until") {
      const top = stack.pop();

      if (!top || top.type !== "repeat") {
        addIssue(
          issues,
          "UNEXPECTED_UNTIL",
          "Unexpected 'until' keyword.",
          token.start,
          "error"
        );

        return false;
      }
    }
  }

  if (stack.length > 0) {
    const top = stack[stack.length - 1];

    addIssue(
      issues,
      "UNCLOSED_BLOCK",
      `Block '${top.type}' has no matching terminator.`,
      top.position,
      "error"
    );

    return false;
  }

  return true;
}

function detectFeatures(tokens: LuauToken[]): string[] {
  const features: string[] = [];

  for (const pattern of FEATURE_PATTERNS) {
    if (pattern.detect(tokens)) {
      features.push(pattern.name);
    }
  }

  return features;
}

function checkVMSubset(
  tokens: LuauToken[],
  issues: CompatibilityIssue[]
): boolean {
  let supported = true;

  for (const token of tokens) {
    if (token.type === "number" ||
        token.type === "string" ||
        token.type === "long_string") {
      if (token.type !== "number") {
        supported = false;
      }

      continue;
    }

    if (token.type === "identifier") {
      continue;
    }

    if (token.type === "keyword") {
      if (!VM_KEYWORDS.has(token.value)) {
        supported = false;
      }

      continue;
    }

    if (token.type === "operator") {
      if (!VM_OPERATORS.has(token.value)) {
        supported = false;
      }

      continue;
    }

    if (token.type === "symbol") {
      if (!VM_SYMBOLS.has(token.value)) {
        supported = false;
      }

      continue;
    }

    supported = false;
  }

  if (!supported) {
    addIssue(
      issues,
      "VM_SUBSET_LIMIT",
      "Source contains syntax outside the currently supported VM subset.",
      0,
      "warning"
    );
  }

  return supported;
}

export function analyzeLuauCompatibility(
  source: string
): LuauCompatibilityReport {
  const issues: CompatibilityIssue[] = [];

  if (typeof source !== "string") {
    return {
      success: false,
      structurallyValid: false,
      vmSupported: false,
      level: "unsupported",
      tokenCount: 0,
      features: [],
      unsupportedFeatures: [],
      issues: [{
        code: "INVALID_SOURCE",
        message: "Source must be a string.",
        position: 0,
        severity: "error",
      }],
    };
  }

  if (source.length === 0 || source.trim().length === 0) {
    return {
      success: false,
      structurallyValid: false,
      vmSupported: false,
      level: "unsupported",
      tokenCount: 0,
      features: [],
      unsupportedFeatures: [],
      issues: [{
        code: "EMPTY_SOURCE",
        message: "Source code cannot be empty.",
        position: 0,
        severity: "error",
      }],
    };
  }

  if (source.length > 100_000) {
    return {
      success: false,
      structurallyValid: false,
      vmSupported: false,
      level: "unsupported",
      tokenCount: 0,
      features: [],
      unsupportedFeatures: [],
      issues: [{
        code: "SOURCE_TOO_LARGE",
        message: "Source exceeds the 100000 character limit.",
        position: 0,
        severity: "error",
      }],
    };
  }

  let tokens: LuauToken[];

  try {
    tokens = tokenizeLuau(source);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Tokenizer failed.";

    return {
      success: false,
      structurallyValid: false,
      vmSupported: false,
      level: "unsupported",
      tokenCount: 0,
      features: [],
      unsupportedFeatures: [],
      issues: [{
        code: "TOKENIZER_ERROR",
        message,
        position: 0,
        severity: "error",
      }],
    };
  }

  const delimitersValid = validateDelimiters(tokens, issues);
  const blocksValid = validateBlocks(tokens, issues);

  const structurallyValid =
    delimitersValid && blocksValid;

  const features = detectFeatures(tokens);

  const vmSupported =
    structurallyValid &&
    checkVMSyntax(tokens, issues);

  const unsupportedFeatures = features.filter(feature =>
    [
      "functions",
      "loops",
      "conditionals",
      "tables",
      "member-access",
      "indexing",
      "method-calls",
      "type-syntax",
      "compound-assignment",
      "coroutines",
      "error-handling",
      "dynamic-loading",
      "varargs",
    ].includes(feature)
  );

  let level: CompatibilityLevel;

  if (!structurallyValid) {
    level = "unsupported";
  } else if (vmSupported) {
    level = "vm-supported";
  } else {
    level = "partially-supported";
  }

  return {
    success: structurallyValid,
    structurallyValid,
    vmSupported,
    level,
    tokenCount: tokens.length,
    features,
    unsupportedFeatures,
    issues,
  };
}

function checkVMSyntax(
  tokens: LuauToken[],
  issues: CompatibilityIssue[]
): boolean {
  return checkVMSubset(tokens, issues);
}
