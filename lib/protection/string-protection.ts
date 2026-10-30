
import { randomBytes } from "node:crypto";
import { tokenizeLuau } from "../tokenizer";

export interface StringProtectionResult {
  output: string;
  protectedStrings: number;
  skippedStrings: number;
  warnings: string[];
}

function randomName(existing: Set<string>): string {
  let name: string;

  do {
    name = "_vxc_" + randomBytes(8).toString("hex");
  } while (existing.has(name));

  existing.add(name);
  return name;
}

function encodeString(value: string, key: number): number[] {
  const bytes = new TextEncoder().encode(value);

  return Array.from(bytes, (byte, index) =>
    (byte + key + (index + 1) * 17) % 256
  );
}

export function protectStrings(
  source: string
): StringProtectionResult {
  const tokens = tokenizeLuau(source);

  const existing = new Set(
    source.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []
  );

  const decoderName = randomName(existing);

  const replacements: Array<{
    start: number;
    end: number;
    value: string;
  }> = [];

  let protectedStrings = 0;
  let skippedStrings = 0;

  const warnings: string[] = [];

  for (const token of tokens) {
    if (
      token.type !== "string" &&
      token.type !== "long_string"
    ) {
      continue;
    }

    // Escaped and long strings are conservatively
    // preserved until their complete Luau escape
    // semantics are implemented.
    if (
      token.type !== "string" ||
      token.value.includes("\\")
    ) {
      skippedStrings++;
      continue;
    }

    const value = token.value.slice(1, -1);
    const key = randomBytes(1)[0];

    const encoded = encodeString(value, key);

    const expression =
      `${decoderName}({${encoded.join(",")}},${key})`;

    replacements.push({
      start: token.start,
      end: token.end,
      value: expression
    });

    protectedStrings++;
  }

  replacements.sort((a, b) => b.start - a.start);

  let output = source;

  for (const replacement of replacements) {
    output =
      output.slice(0, replacement.start) +
      replacement.value +
      output.slice(replacement.end);
  }

  if (protectedStrings > 0) {
    const decoder = `
local function ${decoderName}(data, key)
    local result = {}

    for i = 1, #data do
        result[i] = string.char(
            (data[i] - key - i * 17) % 256
        )
    end

    return table.concat(result)
end
`;

    // Preserve a Luau mode directive at the beginning.
    const directive = output.match(
      /^(\uFEFF?--!(?:strict|nonstrict|nocheck)[^\r\n]*(?:\r?\n|$))/
    );

    const insertionPoint = directive
      ? directive[0].length
      : 0;

    output =
      output.slice(0, insertionPoint) +
      decoder +
      output.slice(insertionPoint);
  }

  if (skippedStrings > 0) {
    warnings.push(
      `${skippedStrings} escaped or long strings were preserved safely.`
    );
  }

  return {
    output,
    protectedStrings,
    skippedStrings,
    warnings
  };
}
