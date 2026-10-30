
import { OPCODES, type VMProgram } from "./instruction-set";
import { executeRegisterVM } from "./register-vm";

const program: VMProgram = {
  version: 1,
  registerCount: 3,

  constants: [150, 250],

  instructions: [
    // R0 = 150
    {
      op: OPCODES.LOADK,
      a: 0,
      b: 0,
      c: 0
    },

    // R1 = 250
    {
      op: OPCODES.LOADK,
      a: 1,
      b: 1,
      c: 0
    },

    // R2 = R0 + R1
    {
      op: OPCODES.ADD,
      a: 2,
      b: 0,
      c: 1
    },

    // Return R2
    {
      op: OPCODES.RETURN,
      a: 2,
      b: 0,
      c: 0
    }
  ]
};

const result = executeRegisterVM(program);

console.log("VM result:", result.value);
console.log("Executed instructions:", result.steps);
console.log("Registers:", result.registers);

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

  if (!failed) {
    throw new Error(
      `Security test failed: ${name} was accepted.`
    );
  }

  console.log(`PASS: ${name} rejected`);
}

const badMagic = bytecode.slice();
badMagic[0] = 0x00;

expectDecodeFailure("Invalid magic header", badMagic);

const truncated = bytecode.slice(0, bytecode.length - 1);

expectDecodeFailure("Truncated bytecode", truncated);
