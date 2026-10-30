
/**
 * VXC Constant Pool
 * Stage 5B
 *
 * Stores unique constants used by VM instructions.
 */

import type { VMConstant } from "./instruction-set";

export class ConstantPool {
  private values: VMConstant[] = [];
  private indexes = new Map<string, number>();

  private makeKey(value: VMConstant): string {
    if (value === null) return "null";

    if (typeof value === "string") {
      return `string:${value}`;
    }

    if (typeof value === "boolean") {
      return `boolean:${value}`;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(
          "VXC constants must contain finite numbers."
        );
      }

      if (Object.is(value, -0)) {
        return "number:-0";
      }

      return `number:${value}`;
    }

    throw new Error("Unsupported VXC constant type.");
  }

  /**
   * Add a constant and return its pool index.
   * Duplicate constants reuse their existing index.
   */
  add(value: VMConstant): number {
    const key = this.makeKey(value);
    const existing = this.indexes.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const index = this.values.length;

    if (index >= 100000) {
      throw new Error("VXC constant pool limit exceeded.");
    }

    this.values.push(value);
    this.indexes.set(key, index);

    return index;
  }

  /**
   * Get a constant by index.
   */
  get(index: number): VMConstant {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.values.length
    ) {
      throw new Error("Invalid VXC constant index.");
    }

    return this.values[index];
  }

  /**
   * Return a safe copy of all constants.
   */
  getAll(): VMConstant[] {
    return [...this.values];
  }

  /**
   * Number of stored constants.
   */
  get size(): number {
    return this.values.length;
  }

  /**
   * Clear the pool.
   */
  clear(): void {
    this.values = [];
    this.indexes.clear();
  }
}
