
/**
 * VXC Register VM
 * Stage 5E - Dispatcher Integration
 *
 * Executes validated VXC bytecode through the
 * centralized instruction dispatcher.
 */

import {
  OPCODES,
  type VMProgram,
  type VMInstruction
} from "./instruction-set";

import {
  createInstructionDispatcher,
  validateDispatchProgram,
  type DispatchContext,
  type OpcodeHandlers
} from "./instruction-dispatcher";

export interface RegisterVMOptions {
  maxSteps?: number;
  globals?: Record<string, unknown>;
}

export interface RegisterVMResult {
  value: unknown;
  steps: number;
  halted: boolean;
  registers: unknown[];
}

interface VMExecutionContext extends DispatchContext {
  program: VMProgram;
  registers: unknown[];
  globals: Record<string, unknown>;
  nextPC: number;
  returnValue: unknown;
  halted: boolean;
}

const DEFAULT_MAX_STEPS = 100000;
const MAX_ALLOWED_STEPS = 1000000;

function isTruthy(value: unknown): boolean {
  // Luau: only false and nil are false.
  return value !== false &&
    value !== undefined &&
    value !== null;
}

function readRegister(
  context: VMExecutionContext,
  index: number
): unknown {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= context.registers.length
  ) {
    throw new Error(
      `VXC VM: invalid register ${index} at instruction ${context.pc}.`
    );
  }

  return context.registers[index];
}

function writeRegister(
  context: VMExecutionContext,
  index: number,
  value: unknown
): void {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= context.registers.length
  ) {
    throw new Error(
      `VXC VM: invalid destination register ${index} at instruction ${context.pc}.`
    );
  }

  context.registers[index] = value;
}

function readNumber(
  context: VMExecutionContext,
  index: number
): number {
  const value = readRegister(context, index);

  if (typeof value !== "number") {
    throw new Error(
      `VXC VM: expected number in register ${index} at instruction ${context.pc}.`
    );
  }

  return value;
}

function readStringConstant(
  context: VMExecutionContext,
  index: number
): string {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= context.program.constants.length
  ) {
    throw new Error(
      `VXC VM: invalid constant index at instruction ${context.pc}.`
    );
  }

  const value = context.program.constants[index];

  if (typeof value !== "string") {
    throw new Error(
      `VXC VM: expected string constant at instruction ${context.pc}.`
    );
  }

  return value;
}

function isRestrictedGlobal(name: string): boolean {
  return (
    name === "__proto__" ||
    name === "prototype" ||
    name === "constructor"
  );
}

function compareValues(
  left: unknown,
  right: unknown,
  pc: number
): number {
  if (
    typeof left === "number" &&
    typeof right === "number"
  ) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  if (
    typeof left === "string" &&
    typeof right === "string"
  ) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  throw new Error(
    `VXC VM: incompatible comparison at instruction ${pc}.`
  );
}

function concatenate(
  left: unknown,
  right: unknown,
  pc: number
): string {
  const valid = (value: unknown) =>
    typeof value === "string" ||
    typeof value === "number";

  if (!valid(left) || !valid(right)) {
    throw new Error(
      `VXC VM: invalid CONCAT operands at instruction ${pc}.`
    );
  }

  return String(left) + String(right);
}

/**
 * Build the opcode handler registry.
 */
function createHandlers(): OpcodeHandlers<VMExecutionContext> {
  return {
    [OPCODES.NOP]: () => {},

    [OPCODES.LOADK]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        context.program.constants[instruction.b]
      );
    },

    [OPCODES.MOVE]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        readRegister(context, instruction.b)
      );
    },

    [OPCODES.ADD]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        readNumber(context, instruction.b) +
          readNumber(context, instruction.c)
      );
    },

    [OPCODES.SUB]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        readNumber(context, instruction.b) -
          readNumber(context, instruction.c)
      );
    },

    [OPCODES.MUL]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        readNumber(context, instruction.b) *
          readNumber(context, instruction.c)
      );
    },

    [OPCODES.DIV]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        readNumber(context, instruction.b) /
          readNumber(context, instruction.c)
      );
    },

    [OPCODES.MOD]: (instruction, context) => {
      const left = readNumber(context, instruction.b);
      const right = readNumber(context, instruction.c);

      writeRegister(
        context,
        instruction.a,
        left - Math.floor(left / right) * right
      );
    },

    [OPCODES.POW]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        Math.pow(
          readNumber(context, instruction.b),
          readNumber(context, instruction.c)
        )
      );
    },

    [OPCODES.NEG]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        -readNumber(context, instruction.b)
      );
    },

    [OPCODES.EQ]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        readRegister(context, instruction.b) ===
          readRegister(context, instruction.c)
      );
    },

    [OPCODES.LT]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        compareValues(
          readRegister(context, instruction.b),
          readRegister(context, instruction.c),
          context.pc
        ) < 0
      );
    },

    [OPCODES.LE]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        compareValues(
          readRegister(context, instruction.b),
          readRegister(context, instruction.c),
          context.pc
        ) <= 0
      );
    },

    [OPCODES.NOT]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        !isTruthy(readRegister(context, instruction.b))
      );
    },

    [OPCODES.JMP]: (instruction, context) => {
      context.nextPC = instruction.a;
    },

    [OPCODES.JMPIF]: (instruction, context) => {
      if (isTruthy(readRegister(context, instruction.a))) {
        context.nextPC = instruction.b;
      }
    },

    [OPCODES.JMPIFNOT]: (instruction, context) => {
      if (!isTruthy(readRegister(context, instruction.a))) {
        context.nextPC = instruction.b;
      }
    },

    [OPCODES.GETGLOBAL]: (instruction, context) => {
      const name = readStringConstant(context, instruction.b);

      if (isRestrictedGlobal(name)) {
        throw new Error(
          `VXC VM: restricted global name at instruction ${context.pc}.`
        );
      }

      const value = Object.prototype.hasOwnProperty.call(
        context.globals,
        name
      )
        ? context.globals[name]
        : undefined;

      writeRegister(context, instruction.a, value);
    },

    [OPCODES.SETGLOBAL]: (instruction, context) => {
      const name = readStringConstant(context, instruction.a);

      if (isRestrictedGlobal(name)) {
        throw new Error(
          `VXC VM: restricted global name at instruction ${context.pc}.`
        );
      }

      context.globals[name] = readRegister(
        context,
        instruction.b
      );
    },

    [OPCODES.CONCAT]: (instruction, context) => {
      writeRegister(
        context,
        instruction.a,
        concatenate(
          readRegister(context, instruction.b),
          readRegister(context, instruction.c),
          context.pc
        )
      );
    },

    [OPCODES.LEN]: (instruction, context) => {
      const value = readRegister(context, instruction.b);

      if (typeof value !== "string") {
        throw new Error(
          `VXC VM: LEN currently supports strings only at instruction ${context.pc}.`
        );
      }

      writeRegister(context, instruction.a, value.length);
    },

    [OPCODES.RETURN]: (instruction, context) => {
      context.returnValue = readRegister(
        context,
        instruction.a
      );

      context.halted = true;
    },

    [OPCODES.HALT]: (_instruction, context) => {
      context.halted = true;
    }
  };
}

/**
 * Execute a VXC VM program using the dispatcher.
 */
export function executeRegisterVM(
  program: VMProgram,
  options: RegisterVMOptions = {}
): RegisterVMResult {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > MAX_ALLOWED_STEPS
  ) {
    throw new Error("VXC VM: invalid execution step limit.");
  }

  const dispatcher = createInstructionDispatcher(
    createHandlers(),
    { maxInstructions: maxSteps }
  );

  const validationErrors = validateDispatchProgram(
    program,
    dispatcher,
    { maxInstructions: maxSteps }
  );

  if (validationErrors.length > 0) {
    throw new Error(
      `VXC VM validation failed: ${validationErrors.join(" ")}`
    );
  }

  const globals = options.globals ?? Object.create(null);

  if (
    typeof globals !== "object" ||
    globals === null ||
    Array.isArray(globals)
  ) {
    throw new Error("VXC VM: globals must be an object.");
  }

  const context: VMExecutionContext = {
    pc: 0,
    steps: 0,
    program,
    registers: new Array(program.registerCount).fill(undefined),
    globals,
    nextPC: 0,
    returnValue: undefined,
    halted: false
  };

  while (
    context.pc < program.instructions.length &&
    !context.halted
  ) {
    if (context.steps >= maxSteps) {
      throw new Error(
        `VXC VM: execution step limit (${maxSteps}) exceeded.`
      );
    }

    const instruction: VMInstruction =
      program.instructions[context.pc];

    context.nextPC = context.pc + 1;

    dispatcher.dispatch(instruction, context);

    context.steps++;
    context.pc = context.nextPC;
  }

  return {
    value: context.returnValue,
    steps: context.steps,
    halted: context.halted,
    registers: [...context.registers]
  };
}
