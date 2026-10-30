
import { tokenizeLuau } from "./tokenizer";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  tokenCount: number;
}

const PAIRS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{"
};

export function validateLuau(source: string): ValidationResult {
  const errors: string[] = [];

  let tokens;

  try {
    tokens = tokenizeLuau(source);
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error
          ? error.message
          : "Tokenizer error"
      ],
      tokenCount: 0
    };
  }

  const stack: Array<{
    value: string;
    position: number;
  }> = [];

  for (const token of tokens) {
    if (["(", "[", "{"].includes(token.value)) {
      stack.push({
        value: token.value,
        position: token.start
      });

      continue;
    }

    if (PAIRS[token.value]) {
      const previous = stack.pop();

      if (!previous) {
        errors.push(
          `Unexpected '${token.value}' at ${token.start}`
        );
        continue;
      }

      if (previous.value !== PAIRS[token.value]) {
        errors.push(
          `Mismatched delimiter at ${token.start}`
        );
      }
    }
  }

  for (const item of stack) {
    errors.push(
      `Unclosed '${item.value}' at ${item.position}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    tokenCount: tokens.length
  };
}
