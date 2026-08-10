import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

interface RuntimeChecksOutput {
  schemaVersion: number;
  functions: {
    functionLocation: SourceLocation;
    checks: {
      parameterLocation: SourceLocation;
      parameterName: string;
      expectedType: string;
      condition: string;
      code: string;
    }[];
  }[];
}

interface SourceLocation {
  fileLocation: string;
  startLine: number;
  startColumn: number;
}

void test("the CLI accepts locations from a JSON file", () => {
  const outputText = execFileSync(
    process.execPath,
    ["src/index.ts", ".", "test/fixtures/locations.json"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const output = JSON.parse(outputText) as RuntimeChecksOutput;

  assert.equal(output.schemaVersion, 1);
  assert.equal(output.functions.length, 1);
  assert.deepEqual(output.functions[0]?.functionLocation, {
    fileLocation: "test/fixtures/locations.ts",
    startLine: 1,
    startColumn: 1,
  });
  assert.deepEqual(output.functions[0]?.checks[0], {
    parameterLocation: {
      fileLocation: "test/fixtures/locations.ts",
      startLine: 1,
      startColumn: 45,
    },
    parameterName: "checked",
    expectedType: "string",
    condition: 'typeof checked === "string"',
    code: `if (!(typeof checked === "string")) {
  throw new Error(\`TYPE ERROR: Parameter 'checked' is of type 'string', but has a value of \${checked}\`);
}`,
  });
});

void test("the CLI accepts an inline JSON location array", () => {
  const locations = [
    {
      function: {
        fileLocation: "test/fixtures/locations.ts",
        startLine: 5,
        startColumn: 1,
      },
      parameters: [
        {
          fileLocation: "test/fixtures/locations.ts",
          startLine: 5,
          startColumn: 28,
        },
      ],
    },
  ];
  const outputText = execFileSync(
    process.execPath,
    ["src/index.ts", projectRoot, JSON.stringify(locations)],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const output = JSON.parse(outputText) as RuntimeChecksOutput;

  assert.equal(output.functions.length, 1);
  assert.equal(output.functions[0]?.checks.length, 1);
  assert.equal(output.functions[0]?.checks[0]?.parameterName, "value");
  assert.equal(output.functions[0]?.checks[0]?.expectedType, "boolean");
  assert.equal(
    output.functions[0]?.checks[0]?.condition,
    'typeof value === "boolean"',
  );
});
