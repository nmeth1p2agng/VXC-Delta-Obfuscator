export type ExecutionGuardConfig = {
  instructionCount: number;
  maxSteps?: number;
};

export type ExecutionGuard = {
  currentPC(): number;
  validatePC(pc: number): void;
  advance(): number;
  jump(target: number): number;
  finish(): void;
  getSteps(): number;
};

const DEFAULT_MAX_STEPS = 100_000;

export function createExecutionGuard(
  config: ExecutionGuardConfig
): ExecutionGuard {
  const instructionCount = config.instructionCount;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  if (
    !Number.isSafeInteger(instructionCount) ||
    instructionCount < 1 ||
    instructionCount > 100_000
  ) {
    throw new Error("VM: invalid instruction count");
  }

  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1_000_000
  ) {
    throw new Error("VM: invalid execution step limit");
  }

  let pc = 0;
  let steps = 0;
  let finished = false;

  function validatePC(target: number): void {
    if (!Number.isSafeInteger(target)) {
      throw new Error("VM: invalid instruction pointer");
    }

    if (target < 0 || target >= instructionCount) {
      throw new Error("VM: instruction pointer out of range");
    }
  }

  function ensureActive(): void {
    if (finished) {
      throw new Error("VM: execution already finished");
    }

    if (steps >= maxSteps) {
      throw new Error("VM: execution step limit exceeded");
    }
  }

  return {
    currentPC(): number {
      ensureActive();
      validatePC(pc);
      return pc;
    },

    validatePC(target: number): void {
      ensureActive();
      validatePC(target);
    },

    advance(): number {
      ensureActive();

      const nextPC = pc + 1;

      if (nextPC >= instructionCount) {
        throw new Error("VM: execution reached invalid end position");
      }

      pc = nextPC;
      steps += 1;

      return pc;
    },

    jump(target: number): number {
      ensureActive();
      validatePC(target);

      pc = target;
      steps += 1;

      return pc;
    },

    finish(): void {
      if (finished) {
        throw new Error("VM: execution already finished");
      }

      finished = true;
    },

    getSteps(): number {
      return steps;
    },
  };
}
