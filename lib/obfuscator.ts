import {
  checkCompatibility,
  CompatibilityTarget
} from "./compatibility";

import { validateLuau } from "./validator";

import {
  protectIdentifiers
} from "./protection/identifier-protection";

export interface ObfuscationOptions {
  target?: CompatibilityTarget;
}

export interface ObfuscationResult {
  success: boolean;
  output: string;
  errors: string[];
  warnings: string[];
  tokenCount: number;
  detectedGlobals: string[];
  renamedIdentifiers: number;
}

const MAX_SOURCE_LENGTH = 100_000;

export function obfuscateLuau(
  source: string,
  options: ObfuscationOptions = {}
): ObfuscationResult {
  const target = options.target ?? "delta-android";

  const failure = (
    errors: string[]
  ): ObfuscationResult => ({
    success: false,
    output: "",
    errors,
    warnings: [],
    tokenCount: 0,
    detectedGlobals: [],
    renamedIdentifiers: 0
  });

  if (
    typeof source !== "string" ||
    source.trim().length === 0
  ) {
    return failure(["Source code cannot be empty."]);
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    return failure([
      "Source code exceeds the maximum size."
    ]);
  }

  const validation = validateLuau(source);

  if (!validation.valid) {
    return failure(validation.errors);
  }

  const compatibility = checkCompatibility(
    source,
    target
  );

  const protection = protectIdentifiers(source);

  return {
    success: true,
    output: protection.output,
    errors: [],
    warnings: [
      ...compatibility.warnings,
      ...protection.warnings
    ],
    tokenCount: compatibility.tokenCount,
    detectedGlobals: compatibility.detectedGlobals,
    renamedIdentifiers: protection.renamed
  };
}
