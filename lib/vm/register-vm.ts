/**
 * VXC Register-based Virtual Machine
 * Stage 5C
 *
 * Executes a controlled subset of VXC bytecode.
 *
 * Operand format:
 *
 * LOADK       a = destination register, b = constant index
 * MOVE        a = destination register, b = source register
 *
 * ADD/SUB/... a = destination, b = left register, c = right register
 * NEG         a = destination, b = source register
 * NOT         a = destination, b = source register
 *
 * EQ/LT/LE    a = destination, b = left register, c = right register
 *
 * JMP         a = absolute instruction index
 * JMPIF       a = condition register, b = target instruction
 * JMPIFNOT    a = condition register, b = target instruction
 *
 * GETGLOBAL  a = destination register, b = string constant index
 * SETGLOBAL  a = string constant index, b = source register
 *
 * CONCAT      a = destination, b = left register, c = right register
 * LEN         a = destination, b = source register
 *
 * RETURN      a = return-value register
 * HALT        stops execution
 */

import {
  OPCODES,
  validateVMProgram,
  type VMProgram,
  type VMInstruction
} from "./instruction-set";

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

const DEFAULT_MAX_STEPS = 100000;
const MAX_ALLOWED_STEPS = 1000000;

function isTruthy(value: unknown): boolean {
  // Luau treats only false and nil as false.
  return value !== false && value !== undefined &&
    value !== null;
}

function requireNumber(
  value: unknown,
  instructionIndex: number
): number {
  if (typeof value !== "number") {
    throw new Error(
      `VXC VM: expected number at instruction ${instructionIndex}.`
    );
  }

  return value;
}

function requireStringConstant(
  program: VMProgram,
  index: number,
  instructionIndex: number
): string {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= program.constants.length
  ) {
    throw new Error(
      `VXC VM: invalid constant index at instruction ${instructionIndex}.`
    );
  }

  const value = program.constants[index];

  if (typeof value !== "string") {
    throw new Error(
      `VXC VM: expected string constant at instruction ${instructionIndex}.`
    );
  }

  return value;
}

function requireRegister(
  registers: unknown[],
  index: number,
  instructionIndex: number
): number {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= registers.length
  ) {
    throw new Error(
      `VXC VM: invalid register at instruction ${instructionIndex}.`
    );
  }

  return index;
}

function requireTarget(
  target: number,
  instructionCount: number,
  instructionIndex: number
): number {
  if (
    !Number.isInteger(target) ||
    target < 0 ||
    target >= instructionCount
  ) {
    throw new Error(
      `VXC VM: invalid jump target at instruction ${instructionIndex}.`
    );
  }

  return target;
}

function compareValues(
  left: unknown,
  right: unknown,
  instructionIndex: number
): number {
  if (
    typeof left === "number" &&
    typeof right === "number"
  ) {
    return left - right;
  }

  if (
    typeof left === "string" &&
    typeof right === "string"
  ) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  throw new Error(
    `VXC VM: values cannot be ordered at instruction ${instructionIndex}.`
  );
}

function concatenate(
  left: unknown,
  right: unknown,
  instructionIndex: number
): string {
  const valid = (value: unknown) =>
    typeof value === "string" ||
    typeof value === "number";

  if (!valid(left) || !valid(right)) {
    throw new Error(
      `VXC VM: invalid CONCAT operands at instruction ${instructionIndex}.`
    );
  }

  return String(left) + String(right);
}

/**
 * Execute a VXC VM program.
 *
 * This runtime deliberately supports only a subset
 * of the declared opcodes. Unsupported instructions
 * fail explicitly instead of silently producing wrong output.
 */
export function executeRegisterVM(
  program: VMProgram,
  options: RegisterVMOptions = {}
): RegisterVMResult {
  const validationErrors = validateVMProgram(program);

  if (validationErrors.length > 0) {
    throw new Error(
      `VXC VM: ${validationErrors.join(" ")}`
    );
  }

  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > MAX_ALLOWED_STEPS
  ) {
    throw new Error("VXC VM: invalid execution step limit.");
  }

  const globals = options.globals ?? Object.create(null);

  if (
    typeof globals !== "object" ||
    globals === null ||
    Array.isArray(globals)
  ) {
    throw new Error("VXC VM: globals must be an object.");
  }

  const registers: unknown[] =
    new Array(program.registerCount).fill(undefined);

  let pc = 0;
  let steps = 0;
  let returnValue: unknown = undefined;
  let halted = false;

  const read = (
    index: number,
    instructionIndex: number
  ): unknown => {
    return registers[
      requireRegister(registers, index, instructionIndex)
    ];
  };

  const write = (
    index: number,
    value: unknown,
    instructionIndex: number
  ): void => {
    registers[
      requireRegister(registers, index, instructionIndex)
    ] = value;
  };

  while (pc < program.instructions.length) {
    if (steps >= maxSteps) {
      throw new Error(
        `VXC VM: execution step limit (${maxSteps}) exceeded.`
      );
    }

    const currentPC = pc;
    const instruction: VMInstruction =
      program.instructions[currentPC];

    steps++;
    pc++;

    const a = instruction.a;
    const b = instruction.b;
    const c = instruction.c;

    switch (instruction.op) {
      case OPCODES.NOP:
        break;

      case OPCODES.LOADK: {
        if (
          !Number.isInteger(b) ||
          b < 0 ||
          b >= program.constants.length
        ) {
          throw new Error(
            `VXC VM: invalid LOADK constant at instruction ${currentPC}.`
          );
        }

        write(a, program.constants[b], currentPC);
        break;
      }

      case OPCODES.MOVE:
        write(a, read(b, currentPC), currentPC);
        break;

      case OPCODES.ADD: {
        const left = requireNumber(read(b, currentPC), currentPC);
        const right = requireNumber(read(c, currentPC), currentPC);
        write(a, left + right, currentPC);
        break;
      }

      case OPCODES.SUB: {
        const left = requireNumber(read(b, currentPC), currentPC);
        const right = requireNumber(read(c, currentPC), currentPC);
        write(a, left - right, currentPC);
        break;
      }

      case OPCODES.MUL: {
        const left = requireNumber(read(b, currentPC), currentPC);
        const right = requireNumber(read(c, currentPC), currentPC);
        write(a, left * right, currentPC);
        break;
      }

      case OPCODES.DIV: {
        const left = requireNumber(read(b, currentPC), currentPC);
        const right = requireNumber(read(c, currentPC), currentPC);
        write(a, left / right, currentPC);
        break;
      }

      case OPCODES.MOD: {
        const left = requireNumber(read(b, currentPC), currentPC);
        const right = requireNumber(read(c, currentPC), currentPC);
        write(
          a,
          left - Math.floor(left / right) * right,
          currentPC
        );
        break;
      }

      case OPCODES.POW: {
        const left = requireNumber(read(b, currentPC), currentPC);
        const right = requireNumber(read(c, currentPC), currentPC);
        write(a, Math.pow(left, right), currentPC);
        break;
      }

      case OPCODES.NEG: {
        const value = requireNumber(read(b, currentPC), currentPC);
        write(a, -value, currentPC);
        break;
      }

      case OPCODES.EQ:
        write(
          a,
          read(b, currentPC) === read(c, currentPC),
          currentPC
        );
        break;

      case OPCODES.LT:
        write(
          a,
          compareValues(
            read(b, currentPC),
            read(c, currentPC),
            currentPC
          ) < 0,
          currentPC
        );
        break;

      case OPCODES.LE:
        write(
          a,
          compareValues(
            read(b, currentPC),
            read(c, currentPC),
            currentPC
          ) <= 0,
          currentPC
        );
        break;

      case OPCODES.NOT:
        write(a, !isTruthy(read(b, currentPC)), currentPC);
        break;

      case OPCODES.JMP:
        pc = requireTarget(
          a,
          program.instructions.length,
          currentPC
        );
        break;

      case OPCODES.JMPIF:
        if (isTruthy(read(a, currentPC))) {
          pc = requireTarget(
            b,
            program.instructions.length,
            currentPC
          );
        }
        break;

      case OPCODES.JMPIFNOT:
        if (!isTruthy(read(a, currentPC))) {
          pc = requireTarget(
            b,
            program.instructions.length,
            currentPC
          );
        }
        break;

      case OPCODES.GETGLOBAL: {
        const name = requireStringConstant(
          program,
          b,
          currentPC
        );

        write(a, globals[name], currentPC);
        break;
      }

      case OPCODES.SETGLOBAL: {
        const name = requireStringConstant(
          program,
          a,
          currentPC
        );

        if (
          name === "__proto__" ||
          name === "prototype" ||
          name === "constructor"
        ) {
          throw new Error(
            `VXC VM: restricted global name at instruction ${currentPC}.`
          );
        }

        globals[name] = read(b, currentPC);
        break;
      }

      case OPCODES.CONCAT:
        write(
          a,
          concatenate(
            read(b, currentPC),
            read(c, currentPC),
            currentPC
          ),
          currentPC
        );
        break;

      case OPCODES.LEN: {
        const value = read(b, currentPC);

        if (typeof value !== "string") {
          throw new Error(
            `VXC VM: LEN currently supports strings only at instruction ${currentPC}.`
          );
        }

        write(a, value.length, currentPC);
        break;
      }

      case OPCODES.RETURN:
        returnValue = read(a, currentPC);
        halted = true;

        return {
          value: returnValue,
          steps,
          halted,
          registers: [...registers]
        };

      case OPCODES.HALT:
        halted = true;

        return {
          value: undefined,
          steps,
          halted,
          registers: [...registers]
        };

      default:
        throw new Error(
          `VXC VM: unsupported opcode ${instruction.op} at instruction ${currentPC}.`
        );
    }
  }

  return {
    value: returnValue,
    steps,
    halted,
    registers: [...registers]
  };
}
