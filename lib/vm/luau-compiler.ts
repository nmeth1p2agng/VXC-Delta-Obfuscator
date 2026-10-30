
import { tokenizeLuau, type LuauToken } from "../tokenizer";

import {
  OPCODES,
  type Opcode,
  type VMConstant,
  type VMInstruction,
  type VMProgram,
} from "./instruction-set";

type ExpressionResult = {
  register: number;
};

type BinaryOperator = {
  precedence: number;
  opcode: Opcode;
  rightAssociative?: boolean;
};

const BINARY_OPERATORS: Record<string, BinaryOperator> = {
  "+": { precedence: 1, opcode: OPCODES.ADD },
  "-": { precedence: 1, opcode: OPCODES.SUB },
  "*": { precedence: 2, opcode: OPCODES.MUL },
  "/": { precedence: 2, opcode: OPCODES.DIV },
  "%": { precedence: 2, opcode: OPCODES.MOD },
  "^": {
    precedence: 3,
    opcode: OPCODES.POW,
    rightAssociative: true,
  },
};

class LuauSubsetCompiler {
  private tokens: LuauToken[];
  private position = 0;

  private instructions: VMInstruction[] = [];
  private constants: VMConstant[] = [];
  private constantIndexes = new Map<string, number>();

  private locals = new Map<string, number>();

  private nextRegister = 0;
  private returned = false;

  constructor(source: string) {
    this.tokens = tokenizeLuau(source);
  }

  compile(): VMProgram {
    if (this.tokens.length === 0) {
      throw new Error("Source code is empty.");
    }

    while (!this.isAtEnd()) {
      if (this.returned) {
        throw this.error("Code found after return.");
      }

      if (this.match(";")) {
        continue;
      }

      if (this.matchKeyword("local")) {
        this.compileLocal();
        continue;
      }

      if (this.matchKeyword("return")) {
        this.compileReturn();
        continue;
      }

      throw this.error(
        "Unsupported statement. Only local declarations and return are supported."
      );
    }

    if (!this.returned) {
      throw new Error(
        "Program must end with a return statement."
      );
    }

    const program: VMProgram = {
      version: 1,
      registerCount: Math.max(1, this.nextRegister),
      instructions: this.instructions,
      constants: this.constants,
    };

    if (program.registerCount > 65535) {
      throw new Error("VM register limit exceeded.");
    }

    if (program.instructions.length > 100000) {
      throw new Error("VM instruction limit exceeded.");
    }

    return program;
  }

  private compileLocal(): void {
    const name = this.consumeIdentifier(
      "Expected a variable name after local."
    );

    if (this.locals.has(name.value)) {
      throw this.error(
        `Duplicate local variable '${name.value}'.`
      );
    }

    this.consume(
      "=",
      "Expected '=' after local variable name."
    );

    const expression = this.parseExpression();
    const destination = this.allocateRegister();

    this.emit(
      OPCODES.MOVE,
      destination,
      expression.register,
      0
    );

    this.locals.set(name.value, destination);
  }

  private compileReturn(): void {
    if (this.isAtEnd() || this.check(";")) {
      throw this.error("Return requires a value.");
    }

    const expression = this.parseExpression();

    this.emit(
      OPCODES.RETURN,
      expression.register,
      0,
      0
    );

    this.returned = true;

    if (this.match(";") && !this.isAtEnd()) {
      throw this.error("Code found after return.");
    }

    if (!this.isAtEnd()) {
      throw this.error(
        "Only one final return statement is supported."
      );
    }
  }

  private parseExpression(
    minPrecedence = 0
  ): ExpressionResult {
    let left = this.parseUnary();

    while (!this.isAtEnd()) {
      const token = this.peek();

      if (!token || token.type !== "operator") {
        break;
      }

      const operator = BINARY_OPERATORS[token.value];

      if (
        !operator ||
        operator.precedence < minPrecedence
      ) {
        break;
      }

      this.advance();

      const nextMinimum = operator.rightAssociative
        ? operator.precedence
        : operator.precedence + 1;

      const right = this.parseExpression(nextMinimum);
      const destination = this.allocateRegister();

      this.emit(
        operator.opcode,
        destination,
        left.register,
        right.register
      );

      left = { register: destination };
    }

    return left;
  }

  private parseUnary(): ExpressionResult {
    if (this.match("-")) {
      const operand = this.parseExpression(3);
      const destination = this.allocateRegister();

      this.emit(
        OPCODES.NEG,
        destination,
        operand.register,
        0
      );

      return { register: destination };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionResult {
    if (this.match("(")) {
      const expression = this.parseExpression();

      this.consume(
        ")",
        "Expected ')' after expression."
      );

      return expression;
    }

    const token = this.peek();

    if (!token) {
      throw this.error("Expected an expression.");
    }

    if (token.type === "number") {
      this.advance();

      if (
        !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
          token.value
        )
      ) {
        throw this.error(
          `Unsupported number format '${token.value}'.`
        );
      }

      const value = Number(token.value);

      if (!Number.isFinite(value)) {
        throw this.error("Number must be finite.");
      }

      return this.loadConstant(value);
    }

    if (token.type === "keyword") {
      if (token.value === "true") {
        this.advance();
        return this.loadConstant(true);
      }

      if (token.value === "false") {
        this.advance();
        return this.loadConstant(false);
      }

      if (token.value === "nil") {
        this.advance();
        return this.loadConstant(null);
      }
    }

    if (token.type === "identifier") {
      this.advance();

      const register = this.locals.get(token.value);

      if (register === undefined) {
        throw this.error(
          `Unknown or unsupported variable '${token.value}'.`
        );
      }

      return { register };
    }

    throw this.error(
      `Unsupported expression token '${token.value}'.`
    );
  }

  private loadConstant(
    value: VMConstant
  ): ExpressionResult {
    const constantIndex = this.addConstant(value);
    const destination = this.allocateRegister();

    this.emit(
      OPCODES.LOADK,
      destination,
      constantIndex,
      0
    );

    return { register: destination };
  }

  private addConstant(value: VMConstant): number {
    const key = this.constantKey(value);
    const existing = this.constantIndexes.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const index = this.constants.length;

    this.constants.push(value);
    this.constantIndexes.set(key, index);

    return index;
  }

  private constantKey(value: VMConstant): string {
    if (value === null) {
      return "null";
    }

    if (typeof value === "number") {
      return `number:${Object.is(value, -0) ? "-0" : value}`;
    }

    return `${typeof value}:${String(value)}`;
  }

  private allocateRegister(): number {
    if (this.nextRegister >= 65535) {
      throw new Error("VM register limit exceeded.");
    }

    return this.nextRegister++;
  }

  private emit(
    op: Opcode,
    a: number,
    b: number,
    c: number
  ): void {
    this.instructions.push({
      op,
      a,
      b,
      c,
    });
  }

  private consumeIdentifier(
    message: string
  ): LuauToken {
    const token = this.peek();

    if (!token || token.type !== "identifier") {
      throw this.error(message);
    }

    return this.advance();
  }

  private consume(
    value: string,
    message: string
  ): LuauToken {
    if (this.check(value)) {
      return this.advance();
    }

    throw this.error(message);
  }

  private match(value: string): boolean {
    if (!this.check(value)) {
      return false;
    }

    this.advance();
    return true;
  }

  private matchKeyword(value: string): boolean {
    const token = this.peek();

    if (
      !token ||
      token.type !== "keyword" ||
      token.value !== value
    ) {
      return false;
    }

    this.advance();
    return true;
  }

  private check(value: string): boolean {
    return this.peek()?.value === value;
  }

  private peek(): LuauToken | undefined {
    return this.tokens[this.position];
  }

  private advance(): LuauToken {
    const token = this.tokens[this.position++];

    if (!token) {
      throw new Error("Unexpected end of source.");
    }

    return token;
  }

  private isAtEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  private error(message: string): Error {
    const token = this.peek();

    const position = token
      ? token.start
      : this.tokens[this.tokens.length - 1]?.end ?? 0;

    return new Error(
      `Luau compiler error at position ${position}: ${message}`
    );
  }
}

export function compileLuauToVM(
  source: string
): VMProgram {
  if (typeof source !== "string") {
    throw new Error("Source must be a string.");
  }

  if (
    source.length === 0 ||
    source.length > 100000
  ) {
    throw new Error("Source length is invalid.");
  }

  return new LuauSubsetCompiler(source).compile();
}
