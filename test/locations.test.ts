import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

void test("the CLI accepts locations from a JSON file", () => {
  const output = execFileSync(
    process.execPath,
    ["src/index.ts", "test/fixtures/locations.json"],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.match(output, /typeof checked === "string"/);
  assert.doesNotMatch(output, /typeof unchecked === "number"/);
  assert.doesNotMatch(output, /function (?:selected|unselected)/);
  assert.doesNotMatch(output, /return unchecked/);
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
  const output = execFileSync(
    process.execPath,
    ["src/index.ts", JSON.stringify(locations)],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.match(output, /typeof value === "boolean"/);
  assert.doesNotMatch(output, /function (?:selected|unselected)/);
  assert.doesNotMatch(output, /return value/);
});
