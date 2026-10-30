
import { randomInt } from "node:crypto";
import { tokenizeLuau } from "../tokenizer";

export interface NumberProtectionResult {
  output: string;
  protectedNumbers: number;
  skippedNumbers: number;
  warnings: string[];
}

interface Replacement {
  start: number;
  end: number;
  value: string;
}

function encodeInteger(value: number): string {
  // Gunakan offset acak yang berbeda untuk setiap angka.
  const key = randomInt(1000, 100000);
  const encoded = value + key;

  if (
    !Number.isSafeInteger(encoded) ||
    encoded - key !== value
  ) {
    return String(value);
  }

  return `(${encoded}-${key})`;
}

export function protectNumbers(
  source: string,
): NumberProtectionResult {
  const tokens = tokenizeLuau(source);

  const replacements: Replacement[] = [];
  const warnings: string[] = [];

  let protectedNumbers = 0;
  let skippedNumbers = 0;

  for (const token of tokens) {
    if (token.type !== "number") {
      continue;
    }

    // Hanya integer desimal tanpa leading zero.
    // Format pecahan, eksponen, hex, dan binary dilewati.
    if (!/^(?:0|[1-9][0-9]*)$/.test(token.value)) {
      skippedNumbers++;
      continue;
    }

    const value = Number(token.value);

    // Hindari perubahan pada angka di luar rentang aman.
    if (!Number.isSafeInteger(value)) {
      skippedNumbers++;
      continue;
    }

    const expression = encodeInteger(value);

    // Jika angka tidak bisa diubah dengan aman, lewati.
    if (expression === token.value) {
      skippedNumbers++;
      continue;
    }

    replacements.push({
      start: token.start,
      end: token.end,
      value: expression,
    });

    protectedNumbers++;
  }

  // Terapkan dari belakang agar offset token tetap valid.
  replacements.sort((a, b) => b.start - a.start);

  let output = source;

  for (const replacement of replacements) {
    output =
      output.slice(0, replacement.start) +
      replacement.value +
      output.slice(replacement.end);
  }

  if (skippedNumbers > 0) {
    warnings.push(
      `${skippedNumbers} number literals were preserved because their format is not supported yet.`,
    );
  }

  return {
    output,
    protectedNumbers,
    skippedNumbers,
    warnings,
  };
}
