import {
  checkCompatibility,
  CompatibilityTarget
} from "./compatibility";

import { validateLuau } from "./validator";

import {
  protectIdentifiers
} from "./protection/identifier-protection";

import {
  protectNumbers
} from "./protection/number-protection";

import {
  protectStrings
} from "./protection/string-protection";

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
  protectedNumbers: number;
  skippedNumbers: number;
  protectedStrings: number;
  skippedStrings: number;
}

const MAX_SOURCE_LENGTH = 100_000;

export function obfuscateLuau(
  source: string,
  options: ObfuscationOptions = {}
): ObfuscationResult {

  const failure = (errors: string[]): ObfuscationResult => ({
    success: false,
    output: "",
    errors,
    warnings: [],
    tokenCount: 0,
    detectedGlobals: [],
    renamedIdentifiers: 0,
    protectedNumbers: 0,
    skippedNumbers: 0,
    protectedStrings: 0,
    skippedStrings: 0
  });

  if (
    typeof source !== "string" ||
    source.trim().length === 0
  ) {
    return failure(["Source code cannot be empty."]);
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    return failure(["Source code exceeds maximum size."]);
  }

  const validation = validateLuau(source);

  if (!validation.valid) {
    return failure(validation.errors);
  }

  const target = options.target ?? "delta-android";

  const compatibility = checkCompatibility(
    source,
    target
  );

  // Stage 2: Identifier Protection
  const identifierResult = protectIdentifiers(source);

  // Stage 4: Number Protection
  const numberResult = protectNumbers(
    identifierResult.output
  );

  // Stage 3: String Protection
  const stringResult = protectStrings(
    numberResult.output
  );

  return {
    success: true,
    output: stringResult.output,
    errors: [],
    warnings: [
      ...compatibility.warnings,
      ...identifierResult.warnings,
      ...numberResult.warnings,
      ...stringResult.warnings
    ],
    tokenCount: compatibility.tokenCount,
    detectedGlobals: compatibility.detectedGlobals,
    renamedIdentifiers: identifierResult.renamed,
    protectedNumbers: numberResult.protectedNumbers,
    skippedNumbers: numberResult.skippedNumbers,
    protectedStrings: stringResult.protectedStrings,
    skippedStrings: stringResult.skippedStrings
  };
}
