
/**
 * VXC Instruction Dispatcher
 * Stage 5D
 *
 * Provides validated opcode-to-handler dispatch.
 * Execution handlers are supplied by the VM runtime.
 */

import {
  OPCODES,
  isOpcode,
  validateVMProgram,
  type Opcode,
  type VMInstruction,
  type VMProgram
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
    !Number.isInteger(index) ||
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
    !Number.isInteger(index) ||
    index < 0 ||
    index >= constantCount
  ) {
    return `Invalid constant index at instruction ${pc}.`;
  }

  return null;
}

/**
 * Validate operands according to each opcode format.
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
  const instructionCount = program.instructions.length;

  for (let pc = 0; pc < instructionCount; pc++) {
    const instruction = program.instructions[pc];

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

    const jump = (target: number) => {
      if (
        !Number.isInteger(target) ||
        target < 0 ||
        target >= instructionCount
      ) {
        errors.push(
          `Invalid jump target at instruction ${pc}.`
        );
      }
    };

    switch (instruction.op) {
      case OPCODES.NOP:
      case OPCODES.HALT:
        break;

      case OPCODES.LOADK:
        register(instruction.a, "destination");
        constant(instruction.b);
        break;

      case OPCODES.MOVE:
      case OPCODES.NEG:
      case OPCODES.NOT:
      case OPCODES.LEN:
        register(instruction.a, "destination");
        register(instruction.b, "source");
        break;

      case OPCODES.ADD:
      case OPCODES.SUB:
      case OPCODES.MUL:
      case OPCODES.DIV:
      case OPCODES.MOD:
      case OPCODES.POW:
      case OPCODES.EQ:
      case OPCODES.LT:
      case OPCODES.LE:
      case OPCODES.CONCAT:
        register(instruction.a, "destination");
        register(instruction.b, "left");
        register(instruction.c, "right");
        break;

      case OPCODES.JMP:
        jump(instruction.a);
        break;

      case OPCODES.JMPIF:
      case OPCODES.JMPIFNOT:
        register(instruction.a, "condition");
        jump(instruction.b);
        break;

      case OPCODES.GETGLOBAL:
        register(instruction.a, "destination");
        constant(instruction.b);
        if (
          Number.isInteger(instruction.b) &&
          instruction.b >= 0 &&
          instruction.b < constantCount &&
          typeof program.constants[instruction.b] !== "string"
        ) {
          errors.push(
            `GETGLOBAL requires a string constant at instruction ${pc}.`
          );
        }
        break;

      case OPCODES.SETGLOBAL:
        constant(instruction.a);
        register(instruction.b, "source");

        if (
          Number.isInteger(instruction.a) &&
          instruction.a >= 0 &&
          instruction.a < constantCount &&
          typeof program.constants[instruction.a] !== "string"
        ) {
          errors.push(
            `SETGLOBAL requires a string constant at instruction ${pc}.`
          );
        }
        break;

      case OPCODES.RETURN:
        register(instruction.a, "return");
        break;

      // Declared opcodes that do not have an operand
      // contract in the current VM runtime.
      default:
        errors.push(
          `Opcode ${instruction.op} has no validated operand format at instruction ${pc}.`
        );
        break;
    }
  }

  return errors;
}

/**
 * Create an opcode dispatcher.
 *
 * Every executable opcode must have an explicitly
 * registered handler. Missing handlers fail closed.
 */
export function createInstructionDispatcher<TContext>(
  handlers: OpcodeHandlers<TContext>,
  options: DispatcherOptions = {}
): InstructionDispatcher<TContext> {
  const maxInstructions =
    options.maxInstructions ?? DEFAULT_MAX_INSTRUCTIONS;

  if (
    !Number.isInteger(maxInstructions) ||
    maxInstructions < 1 ||
    maxInstructions > MAX_ALLOWED_INSTRUCTIONS
  ) {
    throw new Error(
      "VXC Dispatcher: invalid instruction limit."
    );
  }

  const registered = new Map<Opcode, OpcodeHandler<TContext>>();

  for (const key of Object.keys(handlers)) {
    const opcode = Number(key);

    if (!isOpcode(opcode)) {
      throw new Error(
        `VXC Dispatcher: invalid registered opcode ${key}.`
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

  return {
    dispatch(instruction, context): void {
      if (!instruction || !isOpcode(instruction.op)) {
        throw new Error(
          "VXC Dispatcher: invalid instruction opcode."
        );
      }

      const handler = registered.get(instruction.op);

      if (!handler) {
        throw new Error(
          `VXC Dispatcher: no handler for opcode ${instruction.op}.`
        );
      }

      handler(instruction, context);
    },

    supports(opcode): boolean {
      return isOpcode(opcode) && registered.has(opcode);
    },

    getSupportedOpcodes(): Opcode[] {
      return Array.from(registered.keys()).sort(
        (a, b) => a - b
      );
    }
  };
}

/**
 * Validate a complete program against the handlers
 * registered by a dispatcher.
 */
export function validateDispatchProgram<TContext>(
  program: VMProgram,
  dispatcher: InstructionDispatcher<TContext>,
  options: DispatcherOptions = {}
): string[] {
  const maxInstructions =
    options.maxInstructions ?? DEFAULT_MAX_INSTRUCTIONS;

  const errors = validateInstructionOperands(program);

  if (
    !Number.isInteger(maxInstructions) ||
    maxInstructions < 1 ||
    maxInstructions > MAX_ALLOWED_INSTRUCTIONS
  ) {
    errors.push("Invalid dispatcher instruction limit.");
    return errors;
  }

  if (program.instructions.length > maxInstructions) {
    errors.push("VXC Dispatcher: instruction limit exceeded.");
    return errors;
  }

  for (let pc = 0; pc < program.instructions.length; pc++) {
    const instruction = program.instructions[pc];

    if (!dispatcher.supports(instruction.op)) {
      errors.push(
        `No registered handler for opcode ${instruction.op} at instruction ${pc}.`
      );
    }
  }

  return errors;
}
