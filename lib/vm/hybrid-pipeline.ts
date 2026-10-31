import type { VMProgram } from "./instruction-set";
import { compileLuauToVM } from "./luau-compiler";
import { analyzeLuauCompatibility } from "./compatibility-analyzer";

export type HybridMode = "vm" | "native-fallback";

export type HybridPipelineResult = {
  success: boolean;
  mode: HybridMode;
  vmReady: boolean;
  sourcePreserved: boolean;
  originalLength: number;
  program: VMProgram | null;
  output: string;
  error: string | null;
  warnings: string[];
};

const MAX_SOURCE_LENGTH = 100_000;

export function compileHybridSource(
  source: string
): HybridPipelineResult {
  const fallback = (
    message: string,
    warnings: string[] = []
  ): HybridPipelineResult => ({
    success: true,
    mode: "native-fallback",
    vmReady: false,
    sourcePreserved: true,
    originalLength: source.length,
    program: null,
    output: source,
    error: message,
    warnings,
  });

  if (typeof source !== "string") {
    return {
      success: false,
      mode: "native-fallback",
      vmReady: false,
      sourcePreserved: false,
      originalLength: 0,
      program: null,
      output: "",
      error: "Source must be a string.",
      warnings: [],
    };
  }

  if (!source.trim()) {
    return {
      success: false,
      mode: "native-fallback",
      vmReady: false,
      sourcePreserved: false,
      originalLength: source.length,
      program: null,
      output: "",
      error: "Source code cannot be empty.",
      warnings: [],
    };
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    return {
      success: false,
      mode: "native-fallback",
      vmReady: false,
      sourcePreserved: false,
      originalLength: source.length,
      program: null,
      output: "",
      error: "Source exceeds the 100000 character limit.",
      warnings: [],
    };
  }

  const compatibility = analyzeLuauCompatibility(source);

  if (!compatibility.structurallyValid) {
    return fallback(
      "Source failed structural compatibility analysis.",
      ["Original source was preserved without VM transformation."]
    );
  }

  try {
    const program = compileLuauToVM(source);

    return {
      success: true,
      mode: "vm",
      vmReady: true,
      sourcePreserved: false,
      originalLength: source.length,
      program,
      output: "",
      error: null,
      warnings: [
        "Source was accepted by the current VM compiler.",
        "VM runtime generation and execution must still be tested.",
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown VM compiler error.";

    return fallback(message, [
      "VM compilation was skipped.",
      "Original source was preserved completely.",
      "Native fallback is not VM-protected.",
    ]);
  }
}
