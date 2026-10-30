
import { encodeVMProgram } from "./bytecode-encoder";
import { decodeVMProgram } from "./bytecode-decoder";
import { OPCODES, type VMProgram } from "./instruction-set";
import { executeRegisterVM } from "./register-vm";

function assert(
  condition: boolean,
  message: string
): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

function expectDecodeFailure(
  name: string,
  bytes: Uint8Array
): void {
  let failed = false;

  try {
    decodeVMProgram(bytes);
  } catch {
    failed = true;
  }

  assert(failed, `${name} was accepted`);

  console.log(`PASS: ${name} rejected`);
}

function runTests(): void {
  const originalProgram: VMProgram = {
    version: 1,
    registerCount: 3,

    constants: [150, 250],

    instructions: [
      {
        op: OPCODES.LOADK,
        a: 0,
        b: 0,
        c: 0,
      },
      {
        op: OPCODES.LOADK,
        a: 1,
        b: 1,
        c: 0,
      },
      {
        op: OPCODES.ADD,
        a: 2,
        b: 0,
        c: 1,
      },
      {
        op: OPCODES.RETURN,
        a: 2,
        b: 0,
        c: 0,
      },
    ],
  };

  // 1. Encode program into bytecode.
  const bytecode = encodeVMProgram(originalProgram);

  assert(
    bytecode instanceof Uint8Array,
    "Encoder did not return Uint8Array"
  );

  // 2. Decode bytecode.
  const decodedProgram = decodeVMProgram(bytecode);

  assert(
    decodedProgram.instructions.length ===
      originalProgram.instructions.length,
    "Instruction count mismatch"
  );

  assert(
    decodedProgram.constants.length ===
      originalProgram.constants.length,
    "Constant count mismatch"
  );

  // 3. Execute decoded program.
  const result = executeRegisterVM(decodedProgram);

  assert(
    result.value === 400,
    `Expected 400, received ${String(result.value)}`
  );

  console.log("PASS: VM execution");
  console.log("VM result:", result.value);
  console.log("Executed instructions:", result.steps);
  console.log("Registers:", result.registers);
  console.log("Bytecode size:", bytecode.length);

  // 4. Invalid magic header test.
  const badMagic = bytecode.slice();

  badMagic[0] = 0x00;

  expectDecodeFailure(
    "Invalid magic header",
    badMagic
  );

  // 5. Truncated bytecode test.
  const truncated = bytecode.slice(
    0,
    bytecode.length - 1
  );

  expectDecodeFailure(
    "Truncated bytecode",
    truncated
  );

  console.log("--------------------------------");
  console.log("VXC VM END-TO-END TEST PASSED");
  console.log("--------------------------------");
}

runTests();
