
import {
  checkCompatibility,
  CompatibilityTarget,
} from "./compatibility";

import { validateLuau } from "./validator";

import {
  protectIdentifiers,
} from "./protection/identifier-protection";

import {
  protectNumbers,
} from "./protection/number-protection";

import {
  protectStrings,
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

type StageResult = {
  output: string;
  warnings: string[];
};

function createFailure(
  errors: string[],
  warnings: string[] = [],
): ObfuscationResult {
  return {
    success: false,
    output: "",
    errors,
    warnings,
    tokenCount: 0,
    detectedGlobals: [],
    renamedIdentifiers: 0,
    protectedNumbers: 0,
    skippedNumbers: 0,
    protectedStrings: 0,
    skippedStrings: 0,
  };
}

function validateStage(
  original: string,
  candidate: string,
  stageName: string,
): StageResult {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return {
      output: original,
      warnings: [
        `${stageName}: invalid output; original source preserved.`,
      ],
    };
  }

  if (candidate.length > MAX_SOURCE_LENGTH * 4) {
    return {
      output: original,
      warnings: [
        `${stageName}: output exceeded the safety limit; original source preserved.`,
      ],
    };
  }

  const validation = validateLuau(candidate);

  if (!validation.valid) {
    return {
      output: original,
      warnings: [
        `${stageName}: generated source failed delimiter validation; original source preserved.`,
        ...validation.errors,
      ],
    };
  }

  return {
    output: candidate,
    warnings: [],
  };
}

function executeStage(
  source: string,
  stageName: string,
  transform: (input: string) => string,
): StageResult {
  try {
    const candidate = transform(source);

    return validateStage(
      source,
      candidate,
      stageName,
    );
  } catch (error) {
    return {
      output: source,
      warnings: [
        `${stageName} failed; source was preserved: ${
          error instanceof Error
            ? error.message
            : "unknown error"
        }`,
      ],
    };
  }
}

export function obfuscateLuau(
  source: string,
  options: ObfuscationOptions = {},
): ObfuscationResult {
  if (
    typeof source !== "string" ||
    source.trim().length === 0
  ) {
    return createFailure([
      "Source code cannot be empty.",
    ]);
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    return createFailure([
      `Source code exceeds the ${MAX_SOURCE_LENGTH} character limit.`,
    ]);
  }

  // Validate the original source before transforming it.
  const initialValidation = validateLuau(source);

  if (!initialValidation.valid) {
    return createFailure(
      initialValidation.errors,
    );
  }

  const target: CompatibilityTarget =
    options.target ?? "delta-android";

  let compatibility;

  try {
    compatibility = checkCompatibility(
      source,
      target,
    );
  } catch (error) {
    return createFailure([
      `Compatibility analysis failed: ${
        error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    ]);
  }

  if (!compatibility.compatible) {
    return createFailure(
      compatibility.errors,
      compatibility.warnings,
    );
  }

  let output = source;
  const warnings = [
    ...compatibility.warnings,
  ];

  let renamedIdentifiers = 0;
  let protectedNumbers = 0;
  let skippedNumbers = 0;
  let protectedStrings = 0;
  let skippedStrings = 0;

  // STAGE 1: IDENTIFIER PROTECTION

  try {
    const result = protectIdentifiers(output);

    const checked = validateStage(
      output,
      result.output,
      "Identifier protection",
    );

    output = checked.output;
    warnings.push(...result.warnings);
    warnings.push(...checked.warnings);

    if (checked.output !== result.output) {
      renamedIdentifiers = 0;
    } else {
      renamedIdentifiers = result.renamed;
    }
  } catch (error) {
    warnings.push(
      `Identifier protection failed: ${
        error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    );
  }

  // STAGE 2: NUMBER PROTECTION

  try {
    const result = protectNumbers(output);

    const checked = validateStage(
      output,
      result.output,
      "Number protection",
    );

    output = checked.output;
    warnings.push(...result.warnings);
    warnings.push(...checked.warnings);

    if (checked.output === result.output) {
      protectedNumbers = result.protectedNumbers;
      skippedNumbers = result.skippedNumbers;
    } else {
      skippedNumbers = result.skippedNumbers;
    }
  } catch (error) {
    warnings.push(
      `Number protection failed: ${
        error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    );
  }

  // STAGE 3: STRING PROTECTION

  try {
    const result = protectStrings(output);

    const checked = validateStage(
      output,
      result.output,
      "String protection",
    );

    output = checked.output;
    warnings.push(...result.warnings);
    warnings.push(...checked.warnings);

    if (checked.output === result.output) {
      protectedStrings = result.protectedStrings;
      skippedStrings = result.skippedStrings;
    } else {
      skippedStrings = result.skippedStrings;
    }
  } catch (error) {
    warnings.push(
      `String protection failed: ${
        error instanceof Error
          ? error.message
          : "unknown error"
      }`,
    );
  }

  // FINAL VALIDATION

  const finalValidation = validateLuau(output);

  if (!finalValidation.valid) {
    return createFailure(
      [
        "Final transformed source failed validation.",
        ...finalValidation.errors,
      ],
      warnings,
    );
  }

  return {
    success: true,
    output,
    errors: [],
    warnings,
    tokenCount: initialValidation.tokenCount,
    detectedGlobals: compatibility.detectedGlobals,
    renamedIdentifiers,
    protectedNumbers,
    skippedNumbers,
    protectedStrings,
    skippedStrings,
  };
}
