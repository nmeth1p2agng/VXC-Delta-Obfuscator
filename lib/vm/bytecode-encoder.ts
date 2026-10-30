/**
 * VXC Bytecode Encoder
 * Stage 5B
 *
 * Binary format:
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
  validateVMProgram,
  type VMProgram,
  type VMConstant
} from "./instruction-set";

const MAGIC = [0x56, 0x58, 0x43, 0x42];

class ByteWriter {
  private data: number[] = [];

  writeU8(value: number): void {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 0xFF
    ) {
      throw new Error("Invalid unsigned byte.");
    }

    this.data.push(value);
  }

  writeU16(value: number): void {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 0xFFFF
    ) {
      throw new Error("Invalid unsigned 16-bit value.");
    }

    this.writeU8(value & 0xFF);
    this.writeU8((value >>> 8) & 0xFF);
  }

  writeU32(value: number): void {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 0xFFFFFFFF
    ) {
      throw new Error("Invalid unsigned 32-bit value.");
    }

    this.writeU8(value & 0xFF);
    this.writeU8((value >>> 8) & 0xFF);
    this.writeU8((value >>> 16) & 0xFF);
    this.writeU8((value >>> 24) & 0xFF);
  }

  writeI32(value: number): void {
    if (
      !Number.isInteger(value) ||
      value < -0x80000000 ||
      value > 0x7FFFFFFF
    ) {
      throw new Error(
        "VM instruction operand exceeds signed 32-bit range."
      );
    }

    this.writeU32(value >>> 0);
  }

  writeF64(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite VM number constant.");
    }

    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);

    view.setFloat64(0, value, true);

    this.writeBytes(new Uint8Array(buffer));
  }

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.data.push(byte);
    }
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.data);
  }
}

function writeConstant(
  writer: ByteWriter,
  value: VMConstant
): void {
  if (value === null) {
    writer.writeU8(0);
    return;
  }

  if (value === false) {
    writer.writeU8(1);
    return;
  }

  if (value === true) {
    writer.writeU8(2);
    return;
  }

  if (typeof value === "number") {
    writer.writeU8(3);
    writer.writeF64(value);
    return;
  }

  if (typeof value === "string") {
    writer.writeU8(4);

    const encoded = new TextEncoder().encode(value);

    writer.writeU32(encoded.length);
    writer.writeBytes(encoded);
    return;
  }

  throw new Error("Unsupported VXC constant.");
}

/**
 * Encode a VM program into binary bytecode.
 */
export function encodeVMProgram(
  program: VMProgram
): Uint8Array {
  const errors = validateVMProgram(program);

  if (errors.length > 0) {
    throw new Error(
      `Invalid VXC VM program: ${errors.join(" ")}`
    );
  }

  const writer = new ByteWriter();

  // Header
  writer.writeBytes(Uint8Array.from(MAGIC));
  writer.writeU16(program.version);
  writer.writeU16(program.registerCount);
  writer.writeU32(program.instructions.length);
  writer.writeU32(program.constants.length);

  // Instructions
  for (const instruction of program.instructions) {
    writer.writeU8(instruction.op);
    writer.writeI32(instruction.a);
    writer.writeI32(instruction.b);
    writer.writeI32(instruction.c);
  }

  // Constant pool
  for (const constant of program.constants) {
    writeConstant(writer, constant);
  }

  return writer.finish();
}

/**
 * Convert binary bytecode to hexadecimal text.
 * Useful for debugging and test output.
 */
export function bytecodeToHex(
  bytecode: Uint8Array
): string {
  return Array.from(bytecode)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Return bytecode size.
 */
export function getBytecodeSize(
  bytecode: Uint8Array
): number {
  return bytecode.byteLength;
}
