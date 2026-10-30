
/**
 * VXC Bytecode Decoder
 * Stage 5F
 *
 * Decodes the binary format produced by bytecode-encoder.ts.
 *
 * Header:
 *   4 bytes  Magic: VXCB
 *   2 bytes  VM version
 *   2 bytes  Register count
 *   4 bytes  Instruction count
 *   4 bytes  Constant count
 *
 * Instruction:
 *   1 byte   Opcode
 *   4 bytes  Operand A (signed)
 *   4 bytes  Operand B (signed)
 *   4 bytes  Operand C (signed)
 *
 * Constant tags:
 *   0 = null
 *   1 = false
 *   2 = true
 *   3 = number (Float64)
 *   4 = string (UTF-8)
 */

import {
  isOpcode,
  validateVMProgram,
  type VMProgram,
  type VMConstant,
  type VMInstruction
} from "./instruction-set";

const MAGIC = [0x56, 0x58, 0x43, 0x42];

const MAX_BYTECODE_SIZE = 16 * 1024 * 1024;
const MAX_INSTRUCTIONS = 100000;
const MAX_CONSTANTS = 100000;
const MAX_STRING_LENGTH = 8 * 1024 * 1024;

class ByteReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private ensure(length: number): void {
    if (
      !Number.isInteger(length) ||
      length < 0 ||
      length > this.remaining
    ) {
      throw new Error(
        "VXC Decoder: unexpected end of bytecode."
      );
    }
  }

  readU8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  readU16(): number {
    this.ensure(2);

    const value = this.view.getUint16(
      this.offset,
      true
    );

    this.offset += 2;
    return value;
  }

  readU32(): number {
    this.ensure(4);

    const value = this.view.getUint32(
      this.offset,
      true
    );

    this.offset += 4;
    return value;
  }

  readI32(): number {
    this.ensure(4);

    const value = this.view.getInt32(
      this.offset,
      true
    );

    this.offset += 4;
    return value;
  }

  readF64(): number {
    this.ensure(8);

    const value = this.view.getFloat64(
      this.offset,
      true
    );

    this.offset += 8;

    if (!Number.isFinite(value)) {
      throw new Error(
        "VXC Decoder: non-finite number constant."
      );
    }

    return value;
  }

  readBytes(length: number): Uint8Array {
    this.ensure(length);

    const result = this.bytes.subarray(
      this.offset,
      this.offset + length
    );

    this.offset += length;

    return result;
  }
}

function readConstant(
  reader: ByteReader
): VMConstant {
  const tag = reader.readU8();

  switch (tag) {
    case 0:
      return null;

    case 1:
      return false;

    case 2:
      return true;

    case 3:
      return reader.readF64();

    case 4: {
      const length = reader.readU32();

      if (length > MAX_STRING_LENGTH) {
        throw new Error(
          "VXC Decoder: string constant exceeds size limit."
        );
      }

      const bytes = reader.readBytes(length);

      try {
        return new TextDecoder(
          "utf-8",
          { fatal: true }
        ).decode(bytes);
      } catch {
        throw new Error(
          "VXC Decoder: invalid UTF-8 string constant."
        );
      }
    }

    default:
      throw new Error(
        `VXC Decoder: unknown constant type ${tag}.`
      );
  }
}

/**
 * Decode VXC binary bytecode into a VMProgram.
 */
export function decodeVMProgram(
  bytecode: Uint8Array
): VMProgram {
  if (!(bytecode instanceof Uint8Array)) {
    throw new Error(
      "VXC Decoder: input must be Uint8Array."
    );
  }

  if (bytecode.length > MAX_BYTECODE_SIZE) {
    throw new Error(
      "VXC Decoder: bytecode size limit exceeded."
    );
  }

  if (bytecode.length < 16) {
    throw new Error(
      "VXC Decoder: bytecode header is incomplete."
    );
  }

  const reader = new ByteReader(bytecode);

  // Validate magic header.
  for (const expected of MAGIC) {
    if (reader.readU8() !== expected) {
      throw new Error(
        "VXC Decoder: invalid bytecode magic header."
      );
    }
  }

  const version = reader.readU16();
  const registerCount = reader.readU16();
  const instructionCount = reader.readU32();
  const constantCount = reader.readU32();

  if (version !== 1) {
    throw new Error(
      `VXC Decoder: unsupported version ${version}.`
    );
  }

  if (
    registerCount < 1 ||
    registerCount > 65535
  ) {
    throw new Error(
      "VXC Decoder: invalid register count."
    );
  }

  if (
    instructionCount > MAX_INSTRUCTIONS ||
    constantCount > MAX_CONSTANTS
  ) {
    throw new Error(
      "VXC Decoder: program count limit exceeded."
    );
  }

  // Every instruction requires 13 bytes.
  const instructionBytes = instructionCount * 13;

  if (
    !Number.isSafeInteger(instructionBytes) ||
    instructionBytes > reader.remaining
  ) {
    throw new Error(
      "VXC Decoder: incomplete instruction section."
    );
  }

  const instructions: VMInstruction[] = [];

  for (let index = 0; index < instructionCount; index++) {
    const opcode = reader.readU8();

    if (!isOpcode(opcode)) {
      throw new Error(
        `VXC Decoder: invalid opcode at instruction ${index}.`
      );
    }

    instructions.push({
      op: opcode,
      a: reader.readI32(),
      b: reader.readI32(),
      c: reader.readI32()
    });
  }

  const constants: VMConstant[] = [];

  for (let index = 0; index < constantCount; index++) {
    constants.push(readConstant(reader));
  }

  if (reader.remaining !== 0) {
    throw new Error(
      "VXC Decoder: unexpected trailing bytecode data."
    );
  }

  const program: VMProgram = {
    version,
    registerCount,
    instructions,
    constants
  };

  const errors = validateVMProgram(program);

  if (errors.length > 0) {
    throw new Error(
      `VXC Decoder: invalid program: ${errors.join(" ")}`
    );
  }

  return program;
}
