
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
        `Identifier analysis failed: ${
          error instanceof Error
            ? error.message
            : "unknown error"
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

  // Scope analyzer versi repository saat ini hanya
  // menghasilkan edit untuk identifier yang sudah
  // lolos analisis konservatif.
  const replacements = new Map<string, string>();

  for (const edit of analysis.edits) {
    if (!replacements.has(edit.name)) {
      replacements.set(
        edit.name,
        generateName(existing),
      );
    }
  }

  const edits: IdentifierEdit[] = analysis.edits
    .map((edit) => ({
      ...edit,
      replacement: replacements.get(edit.name)!,
    }))
    .sort((a, b) => b.start - a.start);

  let output = source;
  let previousStart = source.length + 1;

  for (const edit of edits) {
    if (
      edit.start < 0 ||
      edit.end <= edit.start ||
      edit.end > source.length ||
      edit.end > previousStart
    ) {
      return {
        output: source,
        renamed: 0,
        warnings: [
          ...analysis.warnings,
          "Identifier transformation aborted because overlapping or invalid source ranges were detected.",
        ],
      };
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
