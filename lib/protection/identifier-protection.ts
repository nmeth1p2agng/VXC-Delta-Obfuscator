import { randomBytes } from "node:crypto";
import { analyzeIdentifiers, IdentifierEdit } from "./scope-analyzer";

export interface IdentifierProtectionResult {
  output: string;
  renamed: number;
  warnings: string[];
}

function generateName(existing: Set<string>): string {
  let name: string;
  do {
    name = "_vxc_" + randomBytes(7).toString("hex");
  } while (existing.has(name));
  existing.add(name);
  return name;
}

export function protectIdentifiers(source: string): IdentifierProtectionResult {
  const analysis = analyzeIdentifiers(source);
  if (!analysis.supported || analysis.edits.length === 0) {
    return { output: source, renamed: 0, warnings: analysis.warnings };
  }

  const existing = new Set(source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const names = new Map<number, string>();
  for (const edit of analysis.edits) {
    if (!names.has(edit.bindingId)) names.set(edit.bindingId, generateName(existing));
  }

  const edits: IdentifierEdit[] = analysis.edits
    .map(edit => ({ ...edit, replacement: names.get(edit.bindingId)! }))
    .sort((a, b) => b.start - a.start);

  let output = source;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.end > lastStart) continue;
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    lastStart = edit.start;
  }

  return { output, renamed: names.size, warnings: analysis.warnings };
}
