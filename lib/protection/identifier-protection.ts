
import { randomBytes } from "node:crypto";
import {
  analyzeIdentifiers,
  IdentifierEdit
} from "./scope-analyzer";

export interface IdentifierProtectionResult {
  output: string;
  renamed: number;
  warnings: string[];
}

function generateName(existing: Set<string>): string {
  let name = "";

  do {
    name = "_vxc_" + randomBytes(8).toString("hex");
  } while (existing.has(name));

  existing.add(name);

  return name;
}

export function protectIdentifiers(
  source: string
): IdentifierProtectionResult {
  const analysis = analyzeIdentifiers(source);

  if (!analysis.supported || analysis.edits.length === 0) {
    return {
      output: source,
      renamed: 0,
      warnings: analysis.warnings
    };
  }

  const existing = new Set(
    source.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []
  );

  const replacements = new Map<string, string>();

  for (const edit of analysis.edits) {
    if (!replacements.has(edit.name)) {
      replacements.set(
        edit.name,
        generateName(existing)
      );
    }
  }

  const edits: IdentifierEdit[] = analysis.edits.map(
    edit => ({
      ...edit,
      replacement: replacements.get(edit.name)!
    })
  );

  // Apply from the end to preserve original offsets.
  edits.sort((a, b) => b.start - a.start);

  let output = source;

  for (const edit of edits) {
    output =
      output.slice(0, edit.start) +
      edit.replacement +
      output.slice(edit.end);
  }

  return {
    output,
    renamed: replacements.size,
    warnings: analysis.warnings
  };
}
