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
  let name: string;

  do {
    name = "_vxc_" + randomBytes(8).toString("hex");
  } while (existing.has(name));

  existing.add(name);
  return name;
}

function reject(source: string, warnings: string[]): IdentifierProtectionResult {
  return {
    output: source,
    renamed: 0,
    warnings
  };
}

export function protectIdentifiers(
  source: string
): IdentifierProtectionResult {
  const analysis = analyzeIdentifiers(source);
  const warnings = [...analysis.warnings];

  if (!analysis.supported) {
    warnings.push("Identifier protection was skipped because scope analysis was inconclusive.");
    return reject(source, warnings);
  }

  if (analysis.edits.length === 0) {
    return { output: source, renamed: 0, warnings };
  }

  const existing = new Set(
    source.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []
  );

  // A binding is one declaration plus all references resolved to that declaration.
  // Never group by spelling alone: two different scopes may reuse the same name.
  const replacements = new Map<number, string>();
  const occupiedRanges = new Set<string>();

  for (const edit of analysis.edits) {
    if (!Number.isInteger(edit.bindingId) || edit.bindingId < 0) {
      warnings.push("Invalid binding identity; identifier protection was skipped.");
      return reject(source, warnings);
    }

    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end <= edit.start ||
      edit.end > source.length ||
      source.slice(edit.start, edit.end) !== edit.name
    ) {
      warnings.push("Identifier edit did not match the original source; protection was skipped to avoid corrupting code.");
      return reject(source, warnings);
    }

    const rangeKey = `${edit.start}:${edit.end}`;
    if (occupiedRanges.has(rangeKey)) {
      warnings.push("Duplicate identifier edit detected; protection was skipped.");
      return reject(source, warnings);
    }
    occupiedRanges.add(rangeKey);

    if (!replacements.has(edit.bindingId)) {
      replacements.set(edit.bindingId, generateName(existing));
    }
  }

  const edits: IdentifierEdit[] = analysis.edits.map(edit => ({
    ...edit,
    replacement: replacements.get(edit.bindingId)!
  }));

  // Reject overlaps before applying edits from right to left.
  const ascending = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ascending.length; i++) {
    if (ascending[i].start < ascending[i - 1].end) {
      warnings.push("Overlapping identifier edits detected; protection was skipped.");
      return reject(source, warnings);
    }
  }

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
    warnings
  };
}
