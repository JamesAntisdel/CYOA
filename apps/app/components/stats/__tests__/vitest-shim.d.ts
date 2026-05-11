// Minimal ambient declaration for vitest so the app package can typecheck
// these tests without depending on the vitest dist types. Vitest is provided
// at the workspace root by the engine package's devDependency, and tests in
// this folder are executed via that shared binary; we declare only the
// surface used by these test files.
//
// This shim is intentionally test-only — it must not be imported from
// non-test code.
declare module "vitest" {
  type AnyFn = (...args: unknown[]) => unknown | Promise<unknown>;

  export function describe(name: string, fn: AnyFn): void;
  export function it(name: string, fn: AnyFn): void;

  export interface VitestExpect<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    readonly not: VitestExpect<T>;
  }

  export function expect<T>(actual: T): VitestExpect<T>;
}
