import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  makeCheck,
  typeToString,
  type BoxedPrimitiveName,
  type BoxedPrimitiveType,
} from "../src/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

interface RuntimeChecksOutput {
  functions: {
    checks: { condition: string }[];
  }[];
}

const boxedLocations = JSON.stringify([
  {
    function: {
      fileLocation: "test/fixtures/boxed.ts",
      startLine: 1,
      startColumn: 1,
    },
    parameters: [2, 3, 4, 5, 6].map((startLine) => ({
      fileLocation: "test/fixtures/boxed.ts",
      startLine,
      startColumn: 3,
    })),
  },
  {
    function: {
      fileLocation: "test/fixtures/boxed.ts",
      startLine: 15,
      startColumn: 1,
    },
    parameters: [
      {
        fileLocation: "test/fixtures/boxed.ts",
        startLine: 15,
        startColumn: 30,
      },
    ],
  },
]);

const boxedTypes = [
  {
    name: "string",
    displayName: "String",
    primitive: "hello",
    boxed: new String("hello"),
    crossRealmExpression: 'new String("hello")',
    invalid: 1,
  },
  {
    name: "number",
    displayName: "Number",
    primitive: 42,
    boxed: new Number(42),
    crossRealmExpression: "new Number(42)",
    invalid: "42",
  },
  {
    name: "boolean",
    displayName: "Boolean",
    primitive: false,
    boxed: new Boolean(false),
    crossRealmExpression: "new Boolean(false)",
    invalid: 0,
  },
  {
    name: "bigint",
    displayName: "BigInt",
    primitive: 42n,
    boxed: Object(42n) as object,
    crossRealmExpression: "Object(42n)",
    invalid: 42,
  },
  {
    name: "symbol",
    displayName: "Symbol",
    primitive: Symbol("value"),
    boxed: Object(Symbol("value")) as object,
    crossRealmExpression: 'Object(Symbol("value"))',
    invalid: "value",
  },
] satisfies readonly {
  name: BoxedPrimitiveName;
  displayName: string;
  primitive: unknown;
  boxed: object;
  crossRealmExpression: string;
  invalid: unknown;
}[];

void test("boxed primitive checks accept primitive and boxed values", () => {
  for (const boxedType of boxedTypes) {
    const type: BoxedPrimitiveType = {
      kind: "boxed-primitive",
      name: boxedType.name,
    };
    const check = makeCheck("value", type);

    assert.equal(
      evaluateCheck(check, boxedType.primitive),
      true,
      boxedType.name,
    );
    assert.equal(evaluateCheck(check, boxedType.boxed), true, boxedType.name);
    const crossRealmValue = vm.runInNewContext(
      boxedType.crossRealmExpression,
    ) as unknown;
    assert.equal(
      evaluateCheck(check, crossRealmValue),
      true,
      `${boxedType.name} from another realm`,
    );
    assert.equal(
      evaluateCheck(check, boxedType.invalid),
      false,
      boxedType.name,
    );
    assert.equal(typeToString(type), boxedType.displayName);
  }
});

void test("the CLI resolves standard boxed types without expanding them", () => {
  const output = execFileSync(
    process.execPath,
    ["src/index.ts", projectRoot, boxedLocations],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const conditions = getConditions(output);

  for (const boxedType of boxedTypes) {
    assert.ok(
      conditions.some((condition) =>
        new RegExp(
          `Object\\.prototype\\.toString\\.call\\([^)]+\\) === "\\[object ${boxedType.displayName}\\]"`,
        ).test(condition),
      ),
      boxedType.name,
    );
  }
});

void test("user-defined types with boxed primitive names remain structural", () => {
  const output = execFileSync(
    process.execPath,
    ["src/index.ts", projectRoot, boxedLocations],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const conditions = getConditions(output).join("\n");

  assert.match(
    conditions,
    /typeof value === "object" && typeof value\["value"\] === "string"/,
  );
  assert.doesNotMatch(
    conditions,
    /Object\.prototype\.toString\.call\(value\) === "\[object String\]"/,
  );
});

function getConditions(output: string): string[] {
  const parsed = JSON.parse(output) as RuntimeChecksOutput;
  return parsed.functions.flatMap((functionChecks) =>
    functionChecks.checks.map((check) => check.condition),
  );
}

function evaluateCheck(check: string, value: unknown): boolean {
  const result = vm.runInNewContext(`Boolean(${check})`, { value }) as unknown;
  if (typeof result !== "boolean") {
    throw new TypeError("Generated check did not return a boolean.");
  }
  return result;
}
