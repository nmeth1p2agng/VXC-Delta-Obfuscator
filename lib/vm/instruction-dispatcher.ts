
/**
 * VXC Hardened Instruction Dispatcher
 * Stage 5P-D
 */

import {
  OPCODES,
  isOpcode,
  isRuntimeOpcode,
  validateVMProgram,
  type Opcode,
  type VMInstruction,
  type VMProgram,
} from "./instruction-set";

export interface DispatchContext {
  pc: number;
  steps: number;
}

export type OpcodeHandler<TContext> = (
  instruction: VMInstruction,
  context: TContext
) => void;

export type OpcodeHandlers<TContext> =
  Partial<Record<Opcode, OpcodeHandler<TContext>>>;

export interface DispatcherOptions {
  maxInstructions?: number;
}

export interface InstructionDispatcher<TContext> {
  dispatch(
    instruction: VMInstruction,
    context: TContext
  ): void;

  supports(opcode: number): boolean;

  getSupportedOpcodes(): Opcode[];
}

const DEFAULT_MAX_INSTRUCTIONS = 100000;
const MAX_ALLOWED_INSTRUCTIONS = 1000000;

function checkRegister(
  index: number,
  registerCount: number,
  pc: number,
  name: string
): string | null {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= registerCount
  ) {
    return `Invalid ${name} register at instruction ${pc}.`;
  }

  return null;
}

function checkConstant(
  index: number,
  constantCount: number,
  pc: number
): string | null {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= constantCount
  ) {
    return `Invalid constant index at instruction ${pc}.`;
  }

  return null;
}

function validateInstructionShape(
  instruction: VMInstruction
): string | null {
  if (
    !instruction ||
    typeof instruction !== "object"
  ) {
    return "Instruction must be an object.";
  }

  if (!isOpcode(instruction.op)) {
    return "Invalid instruction opcode.";
  }

  if (!isRuntimeOpcode(instruction.op)) {
    return `Unsupported runtime opcode ${instruction.op}.`;
  }

  if (
    !Number.isSafeInteger(instruction.a) ||
    !Number.isSafeInteger(instruction.b) ||
    !Number.isSafeInteger(instruction.c)
  ) {
    return "Instruction contains invalid operands.";
  }

  return null;
}

/**
 * Validate operands according to the actual runtime format.
 */
export function validateInstructionOperands(
  program: VMProgram
): string[] {
  const errors = validateVMProgram(program);

  if (errors.length > 0) {
    return errors;
  }

  const registerCount = program.registerCount;
  const constantCount = program.constants.length;

  for (
    let pc = 0;
    pc < program.instructions.length;
    pc++
  ) {
    const instruction = program.instructions[pc];

    const shapeError =
      validateInstructionShape(instruction);

    if (shapeError) {
      errors.push(
        `${shapeError} At instruction ${pc}.`
      );
      continue;
    }

    const register = (
      index: number,
      name: string
    ) => {
      const error = checkRegister(
        index,
        registerCount,
        pc,
        name
      );

      if (error) errors.push(error);
    };

    const constant = (index: number) => {
      const error = checkConstant(
        index,
        constantCount,
        pc
      );

      if (error) errors.push(error);
    };

    const zero = (
      value: number,
      name: string
    ) => {
      if (value !== 0) {
        errors.push(
          `Unexpected ${name} operand at instruction ${pc}.`
        );
      }
    };

    switch (instruction.op) {
      case OPCODES.LOADK:
        register(instruction.a, "destination");
        constant(instruction.b);
        zero(instruction.c, "C");
        break;

      case OPCODES.MOVE:
        register(instruction.a, "destination");
        register(instruction.b, "source");
        zero(instruction.c, "C");
        break;

      case OPCODES.ADD:
      case OPCODES.SUB:
      case OPCODES.MUL:
      case OPCODES.DIV:
      case OPCODES.MOD:
      case OPCODES.POW:
        register(instruction.a, "destination");
        register(instruction.b, "left");
        register(instruction.c, "right");
        break;

      case OPCODES.NEG:
        register(instruction.a, "destination");
        register(instruction.b, "source");
        zero(instruction.c, "C");
        break;

      case OPCODES.RETURN:
        register(instruction.a, "return");
        zero(instruction.b, "B");
        zero(instruction.c, "C");
        break;

      default:
        errors.push(
          `No runtime operand format for opcode ${instruction.op} at instruction ${pc}.`
        );
        break;
    }
  }

  return errors;
}

/**
 * Create a validated opcode dispatcher.
 */
export function createInstructionDispatcher<TContext>(
  handlers: OpcodeHandlers<TContext>,
  options: DispatcherOptions = {}
): InstructionDispatcher<TContext> {
  const maxInstructions =
    options.maxInstructions ?? DEFAULT_MAX_INSTRUCTIONS;

  if (
    !Number.isSafeInteger(maxInstructions) ||
    maxInstructions < 1 ||
    maxInstructions > MAX_ALLOWED_INSTRUCTIONS
  ) {
    throw new Error(
      "VXC Dispatcher: invalid instruction limit."
    );
  }

  if (
    !handlers ||
    typeof handlers !== "object"
  ) {
    throw new Error(
      "VXC Dispatcher: invalid handler collection."
    );
  }

  const registered =
    new Map<Opcode, OpcodeHandler<TContext>>();

  for (const key of Object.keys(handlers)) {
    const opcode = Number(key);

    if (!isOpcode(opcode)) {
      throw new Error(
        `VXC Dispatcher: invalid registered opcode ${key}.`
      );
    }

    if (!isRuntimeOpcode(opcode)) {
      throw new Error(
        `VXC Dispatcher: unsupported runtime opcode ${key}.`
      );
    }

    const handler = handlers[opcode];

    if (typeof handler !== "function") {
      throw new Error(
        `VXC Dispatcher: invalid handler for opcode ${key}.`
      );
    }

    registered.set(opcode, handler);
  }

  let dispatchCount = 0;

  return {
    dispatch(instruction, context): void {
      const shapeError =
        validateInstructionShape(instruction);

      if (shapeError) {
        throw new Error(
          `VXC Dispatcher: ${shapeError}`
        );
      }

      if (dispatchCount >= maxInstructions) {
        throw new Error(
          "VXC Dispatcher: dispatch instruction limit exceeded."
        );
      }

      const handler =
        registered.get(instruction.op);

      if (!handler) {
        throw new Error(
          `VXC Dispatcher: no handler for opcode ${instruction.op}.`
        );
      }

      dispatchCount++;

      handler(instruction, context);
    },

    supports(opcode): boolean {
      return (
        isRuntimeOpcode(opcode) &&
        registered.has(opcode)
      );
    },

    getSupportedOpcodes(): Opcode[] {
      return Array.from(
        registered.keys()
      ).sort((a, b) => a - b);
    },
  };
}

/**
 * Validate a complete program against registered handlers.
 */
export function validateDispatchProgram<TContext>(
  program: VMProgram,
  dispatcher: InstructionDispatcher<TContext>,
  options: DispatcherOptions = {}
): string[] {
  const maxInstructions =
    options.maxInstructions ?? DEFAULT_MAX_INSTRUCTIONS;

  const errors =
    validateInstructionOperands(program);

  if (
    !Number.isSafeInteger(maxInstructions) ||
    maxInstructions < 1 ||
    maxInstructions > MAX_ALLOWED_INSTRUCTIONS
  ) {
    errors.push(
      "Invalid dispatcher instruction limit."
    );

    return errors;
  }

  if (program.instructions.length > maxInstructions) {
    errors.push(
      "VXC Dispatcher: instruction limit exceeded."
    );
  }

  for (
    let pc = 0;
    pc < program.instructions.length;
    pc++
  ) {
    const instruction = program.instructions[pc];

    if (!dispatcher.supports(instruction.op)) {
      errors.push(
        `No registered handler for opcode ${instruction.op} at instruction ${pc}.`
      );
    }
  }

  return errors;
}
