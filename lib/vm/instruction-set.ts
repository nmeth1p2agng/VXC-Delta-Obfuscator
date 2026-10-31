
/**
 * VXC Custom Instruction Set
 * Stage 5P-D
 */

export const OPCODES = {
  NOP: 0x00,

  LOADK: 0x01,
  MOVE: 0x02,

  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  MOD: 0x14,
  POW: 0x15,
  NEG: 0x16,

  EQ: 0x20,
  LT: 0x21,
  LE: 0x22,
  NOT: 0x23,

  JMP: 0x30,
  JMPIF: 0x31,
  JMPIFNOT: 0x32,

  GETGLOBAL: 0x40,
  SETGLOBAL: 0x41,

  NEWTABLE: 0x50,
  GETTABLE: 0x51,
  SETTABLE: 0x52,

  CONCAT: 0x60,
  LEN: 0x61,
  CALL: 0x62,
  RETURN: 0x63,

  DUP: 0x70,
  POP: 0x71,
  HALT: 0x7F,
} as const;

export type Opcode =
  typeof OPCODES[keyof typeof OPCODES];

export type OpcodeName = keyof typeof OPCODES;

export type VMConstant =
  | string
  | number
  | boolean
  | null;

/**
 * Opcodes actually implemented by the current Luau VM.
 *
 * Other opcodes remain reserved for future stages.
 */
export const SUPPORTED_RUNTIME_OPCODES = [
  OPCODES.LOADK,
  OPCODES.MOVE,
  OPCODES.ADD,
  OPCODES.SUB,
  OPCODES.MUL,
  OPCODES.DIV,
  OPCODES.MOD,
  OPCODES.POW,
  OPCODES.NEG,
  OPCODES.RETURN,
] as const satisfies readonly Opcode[];

const RUNTIME_OPCODE_SET = new Set<number>(
  SUPPORTED_RUNTIME_OPCODES
);

export function isRuntimeOpcode(
  value: number
): value is typeof SUPPORTED_RUNTIME_OPCODES[number] {
  return RUNTIME_OPCODE_SET.has(value);
}

export interface VMInstruction {
  op: Opcode;
  a: number;
  b: number;
  c: number;
}

export interface VMProgram {
  version: number;
  registerCount: number;
  instructions: VMInstruction[];
  constants: VMConstant[];
}

export const OPCODE_NAMES: Record<Opcode, OpcodeName> =
  Object.fromEntries(
    Object.entries(OPCODES).map(([name, value]) => [
      value,
      name,
    ])
  ) as Record<Opcode, OpcodeName>;

export function isOpcode(
  value: number
): value is Opcode {
  return (
    Number.isSafeInteger(value) &&
    Object.values(OPCODES).includes(value as Opcode)
  );
}

export function createInstruction(
  name: OpcodeName,
  a = 0,
  b = 0,
  c = 0
): VMInstruction {
  for (const value of [a, b, c]) {
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
    c,
  };
}

export function validateVMProgram(
  program: VMProgram
): string[] {
  const errors: string[] = [];

  if (!program || typeof program !== "object") {
    return ["Invalid VM program object."];
  }

  if (program.version !== 1) {
    errors.push("Unsupported VXC VM version.");
  }

  if (
    !Number.isSafeInteger(program.registerCount) ||
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

    if (
      !instruction ||
      typeof instruction !== "object" ||
      !isOpcode(instruction.op)
    ) {
      errors.push(
        `Invalid opcode at instruction ${index}.`
      );
      continue;
    }

    for (const operand of [
      instruction.a,
      instruction.b,
      instruction.c,
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
