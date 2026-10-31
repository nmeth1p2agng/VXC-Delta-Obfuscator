
import {
  validateRuntimeHardening,
} from "./runtime-hardening";

import {
  OPCODES,
  validateVMProgram,
  type VMProgram,
  type VMConstant,
  type Opcode,
} from "./instruction-set";

import {
  validateInstructionOperands,
} from "./instruction-dispatcher";

const MAX_VM_STEPS = 100000;
const UINT32_MOD = 4294967296;

const SUPPORTED_OPCODES = new Set<Opcode>([
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

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("VXC Runtime: invalid number constant.");
  }

  return Object.is(value, -0) ? "-0" : String(value);
}

function formatString(value: string): string {
  const bytes = new TextEncoder().encode(value);

  if (bytes.length === 0) {
    return '""';
  }

  return `string.char(${Array.from(bytes).join(",")})`;
}

function formatConstant(value: VMConstant): string {
  if (value === null) {
    return "{0}";
  }

  if (value === false) {
    return "{1}";
  }

  if (value === true) {
    return "{2}";
  }

  if (typeof value === "number") {
    return `{3,${formatNumber(value)}}`;
  }

  if (typeof value === "string") {
    return `{4,${formatString(value)}}`;
  }

  throw new Error("VXC Runtime: unsupported constant.");
}

function formatInstruction(
  instruction: VMProgram["instructions"][number]
): string {
  return `{${instruction.op},${instruction.a},${instruction.b},${instruction.c}}`;
}

/**
 * Creates a deterministic fingerprint from the VM payload.
 */
function createPayloadFingerprint(program: VMProgram): number {
  const parts: string[] = [];

  for (let i = 0; i < program.constants.length; i++) {
    const value = program.constants[i];
    const index = i + 1;

    if (value === null) {
      parts.push(`C${index}0;`);
    } else if (value === false) {
      parts.push(`C${index}1;`);
    } else if (value === true) {
      parts.push(`C${index}2;`);
    } else if (typeof value === "number") {
      parts.push(`C${index}3${formatNumber(value)};`);
    } else if (typeof value === "string") {
      const length = new TextEncoder().encode(value).length;
      parts.push(`C${index}4${length}:${value};`);
    } else {
      throw new Error("VXC Integrity: unsupported constant.");
    }
  }

  for (const instruction of program.instructions) {
    parts.push(
      `I${instruction.op},${instruction.a},${instruction.b},${instruction.c};`
    );
  }

  const bytes = new TextEncoder().encode(parts.join(""));
  let hash = 2166136261;

  for (const byte of bytes) {
    hash = (hash * 131 + byte) % UINT32_MOD;
  }

  return hash;
}

function validateRuntimeProgram(program: VMProgram): void {
  const errors = validateVMProgram(program);

  if (errors.length > 0) {
    throw new Error(
      `VXC Runtime: invalid program: ${errors.join(" ")}`
    );
  }

  const hardeningErrors =
    validateRuntimeHardening(program);

  if (hardeningErrors.length > 0) {
    throw new Error(
      `VXC Runtime Hardening: ${hardeningErrors.join(" ")}`
    );
  }

  const operandErrors = validateInstructionOperands(program);

  if (operandErrors.length > 0) {
    throw new Error(
      `VXC Runtime: invalid operands: ${operandErrors.join(" ")}`
    );
  }

  for (let i = 0; i < program.instructions.length; i++) {
    const instruction = program.instructions[i];

    if (!SUPPORTED_OPCODES.has(instruction.op)) {
      throw new Error(
        `VXC Runtime: unsupported opcode ${instruction.op} at instruction ${i}.`
      );
    }
  }

  if (program.instructions.length === 0) {
    throw new Error("VXC Runtime: program has no instructions.");
  }
}

/**
 * Generate a standalone Luau interpreter.
 * Opcode execution uses a dedicated handler table.
 */
export function renderLuauVM(
  program: VMProgram,
  maxSteps = MAX_VM_STEPS
): string {
  validateRuntimeProgram(program);

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1000000
  ) {
    throw new Error("VXC Runtime: invalid step limit.");
  }

  const constants = program.constants
    .map(formatConstant)
    .join(",");

  const instructions = program.instructions
    .map(formatInstruction)
    .join(",");

  const expectedFingerprint =
    createPayloadFingerprint(program);

  const payload = `
local _p = {
    c = {${constants}},
    i = {${instructions}}
}
`;

  return `${payload}
return (function()
    local _r = {}
    local _pc = 1
    local _steps = 0
    local _limit = ${maxSteps}
    local _expected = ${expectedFingerprint}

    local function _fingerprint(payload)
        local parts = {}

        for index, constant in ipairs(payload.c) do
            local tag = constant[1]

            if tag == 0 then
                parts[#parts + 1] = "C" .. index .. "0;"

            elseif tag == 1 then
                parts[#parts + 1] = "C" .. index .. "1;"

            elseif tag == 2 then
                parts[#parts + 1] = "C" .. index .. "2;"

            elseif tag == 3 then
                parts[#parts + 1] =
                    "C" .. index .. "3" .. tostring(constant[2]) .. ";"

            elseif tag == 4 then
                local value = constant[2]

                parts[#parts + 1] =
                    "C" .. index .. "4" .. #value .. ":" .. value .. ";"

            else
                error("VXC Integrity: invalid constant tag", 0)
            end
        end

        for _, instruction in ipairs(payload.i) do
            parts[#parts + 1] =
                "I"
                .. instruction[1] .. ","
                .. instruction[2] .. ","
                .. instruction[3] .. ","
                .. instruction[4] .. ";"
        end

        local data = table.concat(parts)
        local hash = 2166136261

        for index = 1, #data do
            local byte = string.byte(data, index)
            hash = (hash * 131 + byte) % 4294967296
        end

        return hash
    end

    -- Verify payload before executing instructions.
    if _fingerprint(_p) ~= _expected then
        error("VXC Integrity: payload modification detected", 0)
    end

    local function _number(value, register)
        if type(value) ~= "number" then
            error(
                "VXC VM: expected number in register " .. register,
                0
            )
        end

        return value
    end

    local function _loadConstant(index)
        local constant = _p.c[index]

        if not constant then
            error("VXC VM: invalid constant index", 0)
        end

        local tag = constant[1]

        if tag == 0 then
            return nil
        elseif tag == 1 then
            return false
        elseif tag == 2 then
            return true
        elseif tag == 3 or tag == 4 then
            return constant[2]
        end

        error("VXC VM: invalid constant type", 0)
    end

    -- Opcode handler table.
    -- Each handler returns: result, halted.
    local _handlers = {
        [${OPCODES.LOADK}] = function(a, b, c)
            _r[a] = _loadConstant(b)
            return nil, false
        end,

        [${OPCODES.MOVE}] = function(a, b, c)
            _r[a] = _r[b]
            return nil, false
        end,

        [${OPCODES.ADD}] = function(a, b, c)
            _r[a] = _number(_r[b], b) + _number(_r[c], c)
            return nil, false
        end,

        [${OPCODES.SUB}] = function(a, b, c)
            _r[a] = _number(_r[b], b) - _number(_r[c], c)
            return nil, false
        end,

        [${OPCODES.MUL}] = function(a, b, c)
            _r[a] = _number(_r[b], b) * _number(_r[c], c)
            return nil, false
        end,

        [${OPCODES.DIV}] = function(a, b, c)
            _r[a] = _number(_r[b], b) / _number(_r[c], c)
            return nil, false
        end,

        [${OPCODES.MOD}] = function(a, b, c)
            _r[a] = _number(_r[b], b) % _number(_r[c], c)
            return nil, false
        end,

        [${OPCODES.POW}] = function(a, b, c)
            _r[a] = _number(_r[b], b) ^ _number(_r[c], c)
            return nil, false
        end,

        [${OPCODES.NEG}] = function(a, b, c)
            _r[a] = -_number(_r[b], b)
            return nil, false
        end,

        [${OPCODES.RETURN}] = function(a, b, c)
            return _r[a], true
        end
    }

    -- Main VM dispatch loop.
    while _pc <= #_p.i do
        _steps += 1

        if _steps > _limit then
            error("VXC VM: execution step limit exceeded", 0)
        end

        local instruction = _p.i[_pc]

        if type(instruction) ~= "table" then
            error("VXC VM: malformed instruction", 0)
        end

        local opcode = instruction[1]
        local handler = _handlers[opcode]

        if type(handler) ~= "function" then
            error("VXC VM: unknown instruction opcode", 0)
        end

        local a = instruction[2] + 1
        local b = instruction[3] + 1
        local c = instruction[4] + 1

        local result, halted = handler(a, b, c)

        if halted then
            return result
        end

        _pc += 1
    end

    return nil
end)()
`;
}
