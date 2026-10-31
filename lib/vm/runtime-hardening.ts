import {
  OPCODES,
  type VMProgram,
  type VMInstruction,
} from "./instruction-set";

const MAX_INSTRUCTIONS = 100_000;
const MAX_CONSTANTS = 100_000;
const MAX_STRING_LENGTH = 8 * 1024 * 1024;

const SUPPORTED_OPCODES = new Set<number>([
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
]);

function validRegister(
  index: number,
  count: number
): boolean {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < count
  );
}

function validConstant(value: unknown): boolean {
  if (value === null || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.length <= MAX_STRING_LENGTH;
  }

  return false;
}

function validateInstruction(
  instruction: VMInstruction,
  pc: number,
  program: VMProgram,
  initialized: Set<number>
): string[] {
  const errors: string[] = [];

  const { op, a, b, c } = instruction;
  const registerCount = program.registerCount;

  const read = (index: number, name: string) => {
    if (!validRegister(index, registerCount)) {
      errors.push(
        `Invalid ${name} register at instruction ${pc}.`
      );
    } else if (!initialized.has(index)) {
      errors.push(
        `Uninitialized ${name} register at instruction ${pc}.`
      );
    }
  };

  const write = (index: number, name: string) => {
    if (!validRegister(index, registerCount)) {
      errors.push(
        `Invalid ${name} register at instruction ${pc}.`
      );
    } else {
      initialized.add(index);
    }
  };

  const zero = (value: number, name: string) => {
    if (value !== 0) {
      errors.push(
        `Unexpected ${name} operand at instruction ${pc}.`
      );
    }
  };

  if (!SUPPORTED_OPCODES.has(op)) {
    errors.push(
      `Unsupported runtime opcode ${op} at instruction ${pc}.`
    );

    return errors;
  }

  switch (op) {
    case OPCODES.LOADK:
      write(a, "destination");

      if (
        !Number.isInteger(b) ||
        b < 0 ||
        b >= program.constants.length
      ) {
        errors.push(
          `Invalid constant index at instruction ${pc}.`
        );
      }

      zero(c, "C");
      break;

    case OPCODES.MOVE:
      read(b, "source");
      write(a, "destination");
      zero(c, "C");
      break;

    case OPCODES.ADD:
    case OPCODES.SUB:
    case OPCODES.MUL:
    case OPCODES.DIV:
    case OPCODES.MOD:
    case OPCODES.POW:
      read(b, "left");
      read(c, "right");
      write(a, "destination");
      break;

    case OPCODES.NEG:
      read(b, "source");
      write(a, "destination");
      zero(c, "C");
      break;

    case OPCODES.RETURN:
      read(a, "return");
      zero(b, "B");
      zero(c, "C");
      break;
  }

  return errors;
}

export function validateRuntimeHardening(
  program: VMProgram
): string[] {
  const errors: string[] = [];

  if (!program || typeof program !== "object") {
    return ["Invalid VM program object."];
  }

  if (program.version !== 1) {
    errors.push("Unsupported VM version.");
  }

  if (
    !Number.isInteger(program.registerCount) ||
    program.registerCount < 1 ||
    program.registerCount > 65535
  ) {
    errors.push("Invalid VM register count.");
  }

  if (
    !Array.isArray(program.instructions) ||
    program.instructions.length === 0 ||
    program.instructions.length > MAX_INSTRUCTIONS
  ) {
    errors.push("Invalid VM instruction count.");
  }

  if (
    !Array.isArray(program.constants) ||
    program.constants.length > MAX_CONSTANTS
  ) {
    errors.push("Invalid VM constant pool.");
  }

  if (errors.length > 0) {
    return errors;
  }

  for (let i = 0; i < program.constants.length; i++) {
    if (!validConstant(program.constants[i])) {
      errors.push(
        `Invalid constant at index ${i}.`
      );
    }
  }

  if (errors.length > 0) {
    return errors;
  }

  const initialized = new Set<number>();
  let returned = false;

  for (
    let pc = 0;
    pc < program.instructions.length;
    pc++
  ) {
    const instruction = program.instructions[pc];

    if (!instruction || typeof instruction !== "object") {
      errors.push(`Invalid instruction at ${pc}.`);
      continue;
    }

    if (returned) {
      errors.push(
        `Instruction found after RETURN at ${pc}.`
      );
      continue;
    }

    const operands = [
      instruction.a,
      instruction.b,
      instruction.c,
    ];

    if (
      operands.some(
        (value) => !Number.isSafeInteger(value)
      )
    ) {
      errors.push(
        `Invalid instruction operands at ${pc}.`
      );
      continue;
    }

    const instructionErrors = validateInstruction(
      instruction,
      pc,
      program,
      initialized
    );

    errors.push(...instructionErrors);

    if (instruction.op === OPCODES.RETURN) {
      returned = true;

      if (pc !== program.instructions.length - 1) {
        errors.push(
          "RETURN must be the final instruction."
        );
      }
    }
  }

  if (!returned) {
    errors.push("VM program has no final RETURN instruction.");
  }

  return errors;
}
