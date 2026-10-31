import { compileToLuauVM } from "./vm-pipeline";
import { analyzeLuauCompatibility } from "./compatibility-analyzer";

export type HybridMode = "vm" | "native-fallback";

export type HybridPipelineResult = {
  success: boolean;
  mode: HybridMode;
  vmReady: boolean;
  sourcePreserved: boolean;
  originalLength: number;
  output: string;
  bytecodeSize: number;
  instructionCount: number;
  constantCount: number;
  registerCount: number;
  error: string | null;
  warnings: string[];
};

const MAX_SOURCE_LENGTH = 100_000;

export function compileHybridSource(
  source: string,
  maxSteps = 100_000
): HybridPipelineResult {
  if (typeof source !== "string") {
    throw new Error("Source must be a string.");
  }

  if (!source.trim()) {
    throw new Error("Source code cannot be empty.");
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    throw new Error("Source exceeds the 100000 character limit.");
  }

  const fallback = (
    message: string,
    warnings: string[] = []
  ): HybridPipelineResult => ({
    success: true,
    mode: "native-fallback",
    vmReady: false,
    sourcePreserved: true,
    originalLength: source.length,
    output: source,
    bytecodeSize: 0,
    instructionCount: 0,
    constantCount: 0,
    registerCount: 0,
    error: message,
    warnings: [
      ...warnings,
      "Original source was preserved completely.",
      "Native fallback is not VM-protected.",
    ],
  });

  try {
    const compatibility = analyzeLuauCompatibility(source);

    if (!compatibility.structurallyValid) {
      return fallback(
        "Source failed structural compatibility analysis."
      );
    }

    const result = compileToLuauVM(source, {
      maxSteps,
    });

    if (!result.success || !result.output) {
      return fallback(
        "VM pipeline did not generate valid output."
      );
    }

    return {
      success: true,
      mode: "vm",
      vmReady: true,
      sourcePreserved: false,
      originalLength: source.length,
      output: result.output,
      bytecodeSize: result.bytecodeSize,
      instructionCount: result.instructionCount,
      constantCount: result.constantCount,
      registerCount: result.registerCount,
      error: null,
      warnings: [
        ...result.warnings,
        "Bytecode encoding and decoding completed.",
        "Luau VM runtime generation completed.",
        "Generated output has not yet been executed in Delta.",
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown VM pipeline error.";

    return fallback(message, [
      "VM pipeline failed.",
      "VM output was discarded.",
    ]);
  }
}
