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

const DEFAULT_MAX_STEPS = 100000;

export function compileToLuauVM(
  source: string,
  options: VMPipelineOptions = {}
): VMPipelineResult {
  if (typeof source !== "string") {
    throw new Error("VXC VM: source must be a string.");
  }

  if (source.length === 0 || source.length > 100000) {
    throw new Error("VXC VM: invalid source length.");
  }

  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1000000
  ) {
    throw new Error("VXC VM: invalid execution limit.");
  }

  // Stage 1: Compile Luau into VM instructions.
  const program = compileLuauToVM(source);

  // Stage 2: Encode VM instructions.
  const bytecode = encodeVMProgram(program);

  // Stage 3: Decode and validate the encoded bytecode.
  const decodedProgram = decodeVMProgram(bytecode);

  // Stage 4: Generate standalone Luau runtime.
  const output = renderLuauVM(
    decodedProgram,
    maxSteps
  );

  if (
    typeof output !== "string" ||
    output.length === 0
  ) {
    throw new Error("VXC VM: runtime generation failed.");
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
      "Generated Luau runtime requires testing in the target executor.",
      "The embedded instruction representation is not encrypted."
    ]
  };
}
