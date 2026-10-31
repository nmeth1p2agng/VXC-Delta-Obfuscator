
import {
  validateRuntimeHardening,
} from "./runtime-hardening";

import {
  OPCODES,
  SUPPORTED_RUNTIME_OPCODES,
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

const SUPPORTED_OPCODES = new Set<Opcode>(
  SUPPORTED_RUNTIME_OPCODES
);

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      "VXC Runtime: invalid number constant."
    );
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
    const canonical = formatNumber(value);
    return `{3,${formatString(canonical)}}`;
  }

  if (typeof value === "string") {
    return `{4,${formatString(value)}}`;
  }

  throw new Error(
    "VXC Runtime: unsupported constant."
  );
}

function formatInstruction(
  instruction: VMProgram["instructions"][number]
): string {
  return `{${instruction.op},${instruction.a},${instruction.b},${instruction.c}}`;
}

/**
 * Stage 5P-G:
 * Metadata, constants and instructions are included
 * in one deterministic payload fingerprint.
 */
function createPayloadFingerprint(
  program: VMProgram,
  maxSteps: number
): number {
  const parts: string[] = [];

  parts.push(
    `M${program.version},${program.registerCount},${program.constants.length},${program.instructions.length},${maxSteps};`
  );

  for (
    let i = 0;
    i < program.constants.length;
    i++
  ) {
    const value = program.constants[i];
    const index = i + 1;

    if (value === null) {
      parts.push(`C${index}0;`);

    } else if (value === false) {
      parts.push(`C${index}1;`);

    } else if (value === true) {
      parts.push(`C${index}2;`);

    } else if (typeof value === "number") {
      const canonical = formatNumber(value);

      const length = new TextEncoder()
        .encode(canonical).length;

      parts.push(
        `C${index}3${length}:${canonical};`
      );

    } else if (typeof value === "string") {
      const length = new TextEncoder()
        .encode(value).length;

      parts.push(
        `C${index}4${length}:${value};`
      );

    } else {
      throw new Error(
        "VXC Integrity: unsupported constant."
      );
    }
  }

  for (const instruction of program.instructions) {
    parts.push(
      `I${instruction.op},${instruction.a},${instruction.b},${instruction.c};`
    );
  }

  const bytes = new TextEncoder()
    .encode(parts.join(""));

  let hash = 2166136261;

  for (const byte of bytes) {
    hash = (
      hash * 131 + byte
    ) % UINT32_MOD;
  }

  return hash;
}

/**
 * Validate the complete VM program before rendering.
 */
function validateRuntimeProgram(
  program: VMProgram
): void {
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

  const operandErrors =
    validateInstructionOperands(program);

  if (operandErrors.length > 0) {
    throw new Error(
      `VXC Runtime: invalid operands: ${operandErrors.join(" ")}`
    );
  }

  for (
    let i = 0;
    i < program.instructions.length;
    i++
  ) {
    const instruction = program.instructions[i];

    if (!SUPPORTED_OPCODES.has(instruction.op)) {
      throw new Error(
        `VXC Runtime: unsupported opcode ${instruction.op} at instruction ${i}.`
      );
    }
  }

  if (program.instructions.length === 0) {
    throw new Error(
      "VXC Runtime: program has no instructions."
    );
  }
}

/**
 * Generate a standalone Luau interpreter.
 *
 * Stage 5P-G:
 * - Runtime instruction validation
 * - Dedicated opcode handler table
 * - Register initialization tracking
 * - Register boundary validation
 * - Constant pool validation
 * - Canonical numeric constants
 * - Payload fingerprint verification
 * - Execution step limit
 * - Instruction pointer validation
 * - Sequential execution-flow validation
 * - Runtime termination validation
 * - VM metadata integrity
 */
export function renderLuauVM(
  program: VMProgram,
  maxSteps = MAX_VM_STEPS
): string {
  validateRuntimeProgram(program);

  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1000000
  ) {
    throw new Error(
      "VXC Runtime: invalid step limit."
    );
  }

  const constants = program.constants
    .map(formatConstant)
    .join(",");

  const instructions = program.instructions
    .map(formatInstruction)
    .join(",");

  const expectedFingerprint =
    createPayloadFingerprint(program, maxSteps);

  const payload = `
local _p = {
    v = ${program.version},
    r = ${program.registerCount},
    s = ${maxSteps},
    c = {${constants}},
    i = {${instructions}}
}
`;

  return `${payload}
return (function()

    -- =================================
    -- VM METADATA
    -- =================================

    local _version = _p.v
    local _registerLimit = _p.r
    local _limit = _p.s

    local _constantCount = #_p.c
    local _instructionCount = #_p.i

    if type(_version) ~= "number"
        or _version % 1 ~= 0
        or _version ~= 1 then

        error(
            "VXC Integrity: invalid VM version",
            0
        )
    end

    if type(_registerLimit) ~= "number"
        or _registerLimit % 1 ~= 0
        or _registerLimit < 1
        or _registerLimit > 65535 then

        error(
            "VXC Integrity: invalid register metadata",
            0
        )
    end

    if type(_limit) ~= "number"
        or _limit % 1 ~= 0
        or _limit < 1
        or _limit > 1000000 then

        error(
            "VXC Integrity: invalid step metadata",
            0
        )
    end

    if _constantCount > 100000
        or _instructionCount < 1
        or _instructionCount > 100000 then

        error(
            "VXC Integrity: invalid payload size",
            0
        )
    end

    -- =================================
    -- VM STATE
    -- =================================

    local _r = {}
    local _initialized = {}

    local _pc = 1
    local _steps = 0
    local _lastPC = 0

    local _expected = ${expectedFingerprint}

    -- =================================
    -- PAYLOAD FINGERPRINT
    -- =================================

    local function _fingerprint(payload)

        local version = payload.v
        local registers = payload.r
        local stepLimit = payload.s

        if type(version) ~= "number"
            or version % 1 ~= 0
            or type(registers) ~= "number"
            or registers % 1 ~= 0
            or type(stepLimit) ~= "number"
            or stepLimit % 1 ~= 0 then

            error(
                "VXC Integrity: invalid VM metadata",
                0
            )
        end

        local parts = {
            "M"
            .. version .. ","
            .. registers .. ","
            .. #payload.c .. ","
            .. #payload.i .. ","
            .. stepLimit .. ";"
        }

        for index, constant in ipairs(payload.c) do

            if type(constant) ~= "table" then
                error(
                    "VXC Integrity: malformed constant",
                    0
                )
            end

            local tag = constant[1]

            if tag == 0 then
                parts[#parts + 1] =
                    "C" .. index .. "0;"

            elseif tag == 1 then
                parts[#parts + 1] =
                    "C" .. index .. "1;"

            elseif tag == 2 then
                parts[#parts + 1] =
                    "C" .. index .. "2;"

            elseif tag == 3 then
                local value = constant[2]

                if type(value) ~= "string" then
                    error(
                        "VXC Integrity: invalid numeric constant",
                        0
                    )
                end

                parts[#parts + 1] =
                    "C" .. index .. "3"
                    .. #value .. ":" .. value .. ";"

            elseif tag == 4 then
                local value = constant[2]

                if type(value) ~= "string" then
                    error(
                        "VXC Integrity: invalid string constant",
                        0
                    )
                end

                parts[#parts + 1] =
                    "C" .. index .. "4"
                    .. #value .. ":" .. value .. ";"

            else
                error(
                    "VXC Integrity: invalid constant tag",
                    0
                )
            end
        end

        for _, instruction in ipairs(payload.i) do

            if type(instruction) ~= "table"
                or #instruction ~= 4 then

                error(
                    "VXC Integrity: malformed instruction",
                    0
                )
            end

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

            hash = (
                hash * 131 + byte
            ) % 4294967296
        end

        return hash
    end

    if _fingerprint(_p) ~= _expected then
        error(
            "VXC Integrity: payload modification detected",
            0
        )
    end

    -- =================================
    -- REGISTER INTEGRITY
    -- =================================

    local function _validateRegister(index)

        if type(index) ~= "number"
            or index % 1 ~= 0
            or index < 1
            or index > _registerLimit then

            error(
                "VXC VM: register index out of bounds",
                0
            )
        end
    end

    local function _writeRegister(index, value)

        _validateRegister(index)

        _r[index] = value
        _initialized[index] = true
    end

    local function _readRegister(index)

        _validateRegister(index)

        if not _initialized[index] then
            error(
                "VXC VM: uninitialized register access",
                0
            )
        end

        return _r[index]
    end

    -- =================================
    -- NUMBER VALIDATION
    -- =================================

    local function _number(value, register)

        if type(value) ~= "number"
            or value ~= value
            or value == math.huge
            or value == -math.huge then

            error(
                "VXC VM: invalid number in register "
                .. register,
                0
            )
        end

        return value
    end

    -- =================================
    -- CONSTANT DECODER
    -- =================================

    local function _loadConstant(index)

        if type(index) ~= "number"
            or index % 1 ~= 0
            or index < 1
            or index > #_p.c then

            error(
                "VXC VM: invalid constant index",
                0
            )
        end

        local constant = _p.c[index]

        if type(constant) ~= "table" then
            error(
                "VXC VM: malformed constant",
                0
            )
        end

        local tag = constant[1]

        if tag == 0 then
            return nil

        elseif tag == 1 then
            return false

        elseif tag == 2 then
            return true

        elseif tag == 3 then

            local value = tonumber(constant[2])

            if type(value) ~= "number"
                or value ~= value
                or value == math.huge
                or value == -math.huge then

                error(
                    "VXC VM: invalid numeric constant",
                    0
                )
            end

            return value

        elseif tag == 4 then

            if type(constant[2]) ~= "string" then
                error(
                    "VXC VM: invalid string constant",
                    0
                )
            end

            return constant[2]
        end

        error(
            "VXC VM: invalid constant type",
            0
        )
    end

    -- =================================
    -- OPCODE HANDLER TABLE
    -- =================================

    local _handlers = {

        [${OPCODES.LOADK}] = function(a, b, c)

            _writeRegister(
                a,
                _loadConstant(b)
            )

            return nil, false
        end,

        [${OPCODES.MOVE}] = function(a, b, c)

            _writeRegister(
                a,
                _readRegister(b)
            )

            return nil, false
        end,

        [${OPCODES.ADD}] = function(a, b, c)

            _writeRegister(
                a,
                _number(_readRegister(b), b)
                + _number(_readRegister(c), c)
            )

            return nil, false
        end,

        [${OPCODES.SUB}] = function(a, b, c)

            _writeRegister(
                a,
                _number(_readRegister(b), b)
                - _number(_readRegister(c), c)
            )

            return nil, false
        end,

        [${OPCODES.MUL}] = function(a, b, c)

            _writeRegister(
                a,
                _number(_readRegister(b), b)
                * _number(_readRegister(c), c)
            )

            return nil, false
        end,

        [${OPCODES.DIV}] = function(a, b, c)

            _writeRegister(
                a,
                _number(_readRegister(b), b)
                / _number(_readRegister(c), c)
            )

            return nil, false
        end,

        [${OPCODES.MOD}] = function(a, b, c)

            _writeRegister(
                a,
                _number(_readRegister(b), b)
                % _number(_readRegister(c), c)
            )

            return nil, false
        end,

        [${OPCODES.POW}] = function(a, b, c)

            _writeRegister(
                a,
                _number(_readRegister(b), b)
                ^ _number(_readRegister(c), c)
            )

            return nil, false
        end,

        [${OPCODES.NEG}] = function(a, b, c)

            _writeRegister(
                a,
                -_number(_readRegister(b), b)
            )

            return nil, false
        end,

        [${OPCODES.RETURN}] = function(a, b, c)

            return _readRegister(a), true
        end
    }

    -- =================================
    -- EXECUTION FLOW GUARD
    -- =================================

    local function _validatePC(pc)

        if type(pc) ~= "number"
            or pc % 1 ~= 0
            or pc < 1
            or pc > _instructionCount then

            error(
                "VXC VM: invalid instruction pointer",
                0
            )
        end
    end

    local function _validateFlow(pc)

        _validatePC(pc)

        if pc ~= _lastPC + 1 then
            error(
                "VXC VM: execution flow violation",
                0
            )
        end

        _lastPC = pc
    end

    -- =================================
    -- VM DISPATCH LOOP
    -- =================================

    while _pc <= _instructionCount do

        _validateFlow(_pc)

        _steps += 1

        if _steps > _limit then
            error(
                "VXC VM: execution step limit exceeded",
                0
            )
        end

        local currentPC = _pc
        local instruction = _p.i[currentPC]

        if type(instruction) ~= "table" then
            error(
                "VXC VM: malformed instruction",
                0
            )
        end

        if #instruction ~= 4 then
            error(
                "VXC VM: invalid instruction shape",
                0
            )
        end

        local opcode = instruction[1]
        local rawA = instruction[2]
        local rawB = instruction[3]
        local rawC = instruction[4]

        if type(opcode) ~= "number"
            or opcode % 1 ~= 0
            or type(rawA) ~= "number"
            or rawA % 1 ~= 0
            or type(rawB) ~= "number"
            or rawB % 1 ~= 0
            or type(rawC) ~= "number"
            or rawC % 1 ~= 0 then

            error(
                "VXC VM: malformed instruction operand",
                0
            )
        end

        local handler = _handlers[opcode]

        if type(handler) ~= "function" then
            error(
                "VXC VM: unknown instruction opcode",
                0
            )
        end

        -- Compiler indexes are zero-based.
        -- Runtime indexes are one-based.

        local a = rawA + 1
        local b = rawB + 1
        local c = rawC + 1

        local result, halted = handler(a, b, c)

        if halted then
            return result
        end

        if _pc ~= currentPC then
            error(
                "VXC VM: unexpected instruction pointer modification",
                0
            )
        end

        _pc = currentPC + 1
    end

    -- =================================
    -- EXECUTION TERMINATION
    -- =================================

    if _pc ~= _instructionCount + 1 then
        error(
            "VXC VM: invalid execution termination",
            0
        )
    end

    return nil

end)()
`;
}
