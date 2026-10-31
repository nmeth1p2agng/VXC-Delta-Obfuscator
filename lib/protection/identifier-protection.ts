
import { randomBytes } from "node:crypto";
import {
  analyzeIdentifiers,
  type IdentifierEdit,
} from "./scope-analyzer";

export interface IdentifierProtectionResult {
  output: string;
  renamed: number;
  warnings: string[];
}

function generateName(existing: Set<string>): string {
  let name: string;

  do {
    name = "_vxc_" + randomBytes(8).toString("hex");
  } while (existing.has(name));

  existing.add(name);
  return name;
}

export function protectIdentifiers(
  source: string,
): IdentifierProtectionResult {
  let analysis;

  try {
    analysis = analyzeIdentifiers(source);
  } catch (error) {
    return {
      output: source,
      renamed: 0,
      warnings: [
        `Identifier protection skipped: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      ],
    };
  }

  if (!analysis.supported || analysis.edits.length === 0) {
    return {
      output: source,
      renamed: 0,
      warnings: analysis.warnings,
    };
  }

  const existing = new Set(
    source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [],
  );

  // Satu binding mendapat satu nama baru.
  // Variabel dengan nama sama di scope berbeda
  // tetap mendapatkan nama berbeda.
  const replacements = new Map<number, string>();

  for (const edit of analysis.edits) {
    if (!replacements.has(edit.bindingId)) {
      replacements.set(
        edit.bindingId,
        generateName(existing),
      );
    }
  }

  const edits: IdentifierEdit[] = analysis.edits
    .map((edit) => ({
      ...edit,
      replacement: replacements.get(edit.bindingId)!,
    }))
    .sort((a, b) => b.start - a.start);

  let output = source;
  let previousStart = Number.POSITIVE_INFINITY;

  for (const edit of edits) {
    // Hindari edit duplikat atau bertumpuk.
    if (
      edit.start < 0 ||
      edit.end <= edit.start ||
      edit.end > source.length ||
      edit.end > previousStart
    ) {
      continue;
    }

    output =
      output.slice(0, edit.start) +
      edit.replacement +
      output.slice(edit.end);

    previousStart = edit.start;
  }

  return {
    output,
    renamed: replacements.size,
    warnings: analysis.warnings,
  };
}
