import {
  checkCompatibility,
  CompatibilityTarget
} from "./compatibility";

import { validateLuau } from "./validator";

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
}

const MAX_SOURCE_LENGTH = 100_000;

export function obfuscateLuau(
  source: string,
  options: ObfuscationOptions = {}
): ObfuscationResult {
  if (typeof source !== "string" || source.trim().length === 0) {
    return {
      success: false,
      output: "",
      errors: ["Source code cannot be empty."],
      warnings: [],
      tokenCount: 0,
      detectedGlobals: []
    };
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    return {
      success: false,
      output: "",
      errors: ["Source code exceeds the maximum size."],
      warnings: [],
      tokenCount: 0,
      detectedGlobals: []
    };
  }

  const target = options.target ?? "delta-android";

  const validation = validateLuau(source);

  if (!validation.valid) {
    return {
      success: false,
      output: "",
      errors: validation.errors,
      warnings: [],
      tokenCount: validation.tokenCount,
      detectedGlobals: []
    };
  }

  const compatibility = checkCompatibility(
    source,
    target
  );

  return {
    success: true,
    output: source,
    errors: [],
    warnings: compatibility.warnings,
    tokenCount: compatibility.tokenCount,
    detectedGlobals: compatibility.detectedGlobals
  };
}
