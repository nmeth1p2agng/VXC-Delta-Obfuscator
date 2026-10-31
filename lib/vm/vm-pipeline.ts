import { compileLuauToVM } from "./luau-compiler";
import { encodeVMProgram } from "./bytecode-encoder";
import { decodeVMProgram } from "./bytecode-decoder";
import { renderLuauVM } from "./luau-runtime";

export interface VMPipelineOptions {
  maxSteps?: number;
}

export interface VMPipelineResult {
  success: boolean;
  output: string;
  bytecodeSize: number;
  instructionCount: number;
  constantCount: number;
  registerCount: number;
  warnings: string[];
}

const DEFAULT_MAX_STEPS = 100_000;
const MAX_SOURCE_LENGTH = 100_000;

export function compileToLuauVM(
  source: string,
  options: VMPipelineOptions = {}
): VMPipelineResult {
  if (typeof source !== "string") {
    throw new Error("Source must be a string.");
  }

  if (source.trim().length === 0) {
    throw new Error("Source code cannot be empty.");
  }

  if (source.length > MAX_SOURCE_LENGTH) {
    throw new Error("Source code is too large.");
  }

  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1_000_000
  ) {
    throw new Error("Invalid VM execution step limit.");
  }

  const program = compileLuauToVM(source);

  const bytecode = encodeVMProgram(program);

  const decodedProgram = decodeVMProgram(bytecode);

  const output = renderLuauVM(decodedProgram, maxSteps);

  if (typeof output !== "string" || output.length === 0) {
    throw new Error("VM output generation failed.");
  }

  return {
    success: true,
    output,
    bytecodeSize: bytecode.length,
    instructionCount: decodedProgram.instructions.length,
    constantCount: decodedProgram.constants.length,
    registerCount: decodedProgram.registerCount,
    warnings: [
      "Only the supported Luau subset can be compiled.",
      "Generated VM output requires testing in the target executor.",
      "The embedded instruction representation is not encrypted.",
    ],
  };
}
