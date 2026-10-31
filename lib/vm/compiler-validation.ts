import { compileLuauToVM } from "./luau-compiler";

export type VMCompilerValidationResult = {
  success: boolean;
  supported: boolean;
  instructionCount: number;
  constantCount: number;
  registerCount: number;
  error: string | null;
};

export function validateVMCompiler(
  source: string
): VMCompilerValidationResult {
  const failed = (message: string): VMCompilerValidationResult => ({
    success: true,
    supported: false,
    instructionCount: 0,
    constantCount: 0,
    registerCount: 0,
    error: message,
  });

  if (typeof source !== "string") {
    return failed("Source must be a string.");
  }

  if (!source.trim()) {
    return failed("Source code cannot be empty.");
  }

  if (source.length > 100_000) {
    return failed("Source exceeds the 100000 character limit.");
  }

  try {
    const program = compileLuauToVM(source);

    return {
      success: true,
      supported: true,
      instructionCount: program.instructions.length,
      constantCount: program.constants.length,
      registerCount: program.registerCount,
      error: null,
    };
  } catch (error) {
    return failed(
      error instanceof Error
        ? error.message
        : "Unknown VM compiler error."
    );
  }
}
