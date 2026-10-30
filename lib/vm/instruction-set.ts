
/**
 * VXC Custom Instruction Set
 * Stage 5A
 *
 * Defines the instruction format and opcode registry
 * for the VXC register-based virtual machine.
 */

export const OPCODES = {
  NOP: 0x00,

  // Constant and register operations
  LOADK: 0x01,
  MOVE: 0x02,

  // Arithmetic
  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  MOD: 0x14,
  POW: 0x15,
  NEG: 0x16,

  // Comparison and logic
  EQ: 0x20,
  LT: 0x21,
  LE: 0x22,
  NOT: 0x23,

  // Control flow
  JMP: 0x30,
  JMPIF: 0x31,
  JMPIFNOT: 0x32,

  // Global operations
  GETGLOBAL: 0x40,
  SETGLOBAL: 0x41,

  // Table operations
  NEWTABLE: 0x50,
  GETTABLE: 0x51,
  SETTABLE: 0x52,

  // Other operations
  CONCAT: 0x60,
  LEN: 0x61,
  CALL: 0x62,
  RETURN: 0x63,

  // Stack and execution
  DUP: 0x70,
  POP: 0x71,
  HALT: 0x7F
} as const;

export type Opcode =
  typeof OPCODES[keyof typeof OPCODES];

export type OpcodeName =
  keyof typeof OPCODES;

export type VMConstant =
  | string
  | number
  | boolean
  | null;

/**
 * Fixed instruction format.
 *
 * a, b, c are numeric operands.
 * Their meaning depends on the opcode.
 */
export interface VMInstruction {
  op: Opcode;
  a: number;
  b: number;
  c: number;
}

/**
 * VXC bytecode program structure.
 */
export interface VMProgram {
  version: number;
  registerCount: number;
  instructions: VMInstruction[];
  constants: VMConstant[];
}

/**
 * Reverse opcode lookup.
 */
export const OPCODE_NAMES: Record<Opcode, OpcodeName> =
  Object.fromEntries(
    Object.entries(OPCODES).map(([name, value]) => [
      value,
      name
    ])
  ) as Record<Opcode, OpcodeName>;

/**
 * Check whether a numeric value is a valid opcode.
 */
export function isOpcode(
  value: number
): value is Opcode {
  return Number.isInteger(value) &&
    Object.values(OPCODES).includes(
      value as Opcode
    );
}

/**
 * Create a normalized instruction.
 */
export function createInstruction(
  name: OpcodeName,
  a = 0,
  b = 0,
  c = 0
): VMInstruction {
  const values = [a, b, c];

  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        "VXC VM operands must be safe integers."
      );
    }
  }

  return {
    op: OPCODES[name],
    a,
    b,
    c
  };
}

/**
 * Validate a VM program structure.
 */
export function validateVMProgram(
  program: VMProgram
): string[] {
  const errors: string[] = [];

  if (program.version !== 1) {
    errors.push("Unsupported VXC VM version.");
  }

  if (
    !Number.isInteger(program.registerCount) ||
    program.registerCount < 1 ||
    program.registerCount > 65535
  ) {
    errors.push("Invalid VM register count.");
  }

  if (!Array.isArray(program.instructions)) {
    errors.push("Invalid instruction list.");
    return errors;
  }

  if (!Array.isArray(program.constants)) {
    errors.push("Invalid constant pool.");
    return errors;
  }

  if (program.instructions.length > 100000) {
    errors.push("Instruction limit exceeded.");
  }

  if (program.constants.length > 100000) {
    errors.push("Constant pool limit exceeded.");
  }

  for (
    let index = 0;
    index < program.instructions.length;
    index++
  ) {
    const instruction = program.instructions[index];

    if (!instruction || !isOpcode(instruction.op)) {
      errors.push(
        `Invalid opcode at instruction ${index}.`
      );
      continue;
    }

    for (const operand of [
      instruction.a,
      instruction.b,
      instruction.c
    ]) {
      if (!Number.isSafeInteger(operand)) {
        errors.push(
          `Invalid operand at instruction ${index}.`
        );
        break;
      }
    }
  }

  return errors;
}
