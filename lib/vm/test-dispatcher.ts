import {
  OPCODES,
  type VMProgram
} from "./instruction-set";

import {
  createInstructionDispatcher,
  validateDispatchProgram,
  type DispatchContext
} from "./instruction-dispatcher";

interface TestContext extends DispatchContext {
  program: VMProgram;
  registers: number[];
  result: number | undefined;
  halted: boolean;
}

const program: VMProgram = {
  version: 1,
  registerCount: 3,
  constants: [150, 250],

  instructions: [
    { op: OPCODES.LOADK, a: 0, b: 0, c: 0 },
    { op: OPCODES.LOADK, a: 1, b: 1, c: 0 },
    { op: OPCODES.ADD, a: 2, b: 0, c: 1 },
    { op: OPCODES.RETURN, a: 2, b: 0, c: 0 }
  ]
};

const dispatcher = createInstructionDispatcher<TestContext>({
  [OPCODES.LOADK]: (instruction, context) => {
    context.registers[instruction.a] =
      Number(context.program.constants[instruction.b]);
  },

  [OPCODES.ADD]: (instruction, context) => {
    context.registers[instruction.a] =
      context.registers[instruction.b] +
      context.registers[instruction.c];
  },

  [OPCODES.RETURN]: (instruction, context) => {
    context.result = context.registers[instruction.a];
    context.halted = true;
  }
});

const errors = validateDispatchProgram(
  program,
  dispatcher
);

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

const context: TestContext = {
  pc: 0,
  steps: 0,
  program,
  registers: new Array(program.registerCount).fill(0),
  result: undefined,
  halted: false
};

while (
  context.pc < program.instructions.length &&
  !context.halted
) {
  if (context.steps >= 1000) {
    throw new Error("Test instruction limit exceeded.");
  }

  const instruction = program.instructions[context.pc];

  dispatcher.dispatch(instruction, context);

  context.pc++;
  context.steps++;
}

console.log("Dispatcher result:", context.result);
console.log("Executed instructions:", context.steps);
console.log("Supported opcodes:", dispatcher.getSupportedOpcodes());
