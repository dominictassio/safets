import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type FunctionDeclaration,
  type ParameterDeclaration,
  type Symbol,
  type Type,
  type TypeChecker,
} from "ts-morph";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  makeCheck,
  typeToString,
  type BoxedPrimitiveName,
  type Index,
  type ResolvedType,
} from "./types.ts";

const boxedPrimitiveNames: ReadonlyMap<string, BoxedPrimitiveName> = new Map([
  ["String", "string"],
  ["Number", "number"],
  ["Boolean", "boolean"],
  ["BigInt", "bigint"],
  ["Symbol", "symbol"],
]);

const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
};

const arguments_ = process.argv.slice(2);
const locationInput = getLocationInput(arguments_);

if (locationInput === undefined) {
  emitTypeChecks(arguments_, compilerOptions);
} else {
  emitSelectedTypeChecks(parseTargets(locationInput), compilerOptions);
}

interface SourceLocation {
  fileLocation: string;
  startLine: number;
  startColumn: number;
}

interface RuntimeCheckTarget {
  function: SourceLocation;
  parameters: readonly SourceLocation[];
}

interface SelectedFunction {
  declaration: FunctionDeclaration;
  parameters: ParameterDeclaration[];
}

function getLocationInput(arguments_: readonly string[]): string | undefined {
  if (arguments_[0] === "--locations") {
    if (arguments_.length !== 2) {
      throw new Error("Usage: safets --locations <JSON, JSON file, or ->");
    }
    return readLocationArgument(arguments_[1]);
  }

  if (arguments_.length !== 1) {
    return undefined;
  }

  const argument = arguments_[0];
  if (argument.trimStart().startsWith("[")) {
    return argument;
  }
  if (argument.endsWith(".json") || argument === "-") {
    return readLocationInput(argument);
  }

  return undefined;
}

function readLocationInput(input: string): string {
  return input === "-" ? readFileSync(0, "utf8") : readFileSync(input, "utf8");
}

function readLocationArgument(input: string): string {
  return input.trimStart().startsWith("[") ? input : readLocationInput(input);
}

function parseTargets(json: string): RuntimeCheckTarget[] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error("Could not parse runtime-check locations as JSON.", {
      cause: error,
    });
  }

  if (!Array.isArray(value)) {
    throw new TypeError("Runtime-check locations must be a JSON array.");
  }

  return value.map((target, index) => parseTarget(target, index));
}

function parseTarget(value: unknown, index: number): RuntimeCheckTarget {
  if (!isObject(value)) {
    throw new TypeError(
      `Location target at index ${index.toString()} must be an object.`,
    );
  }
  if (!Array.isArray(value.parameters)) {
    throw new TypeError(
      `Location target at index ${index.toString()} must contain a parameters array.`,
    );
  }

  return {
    function: parseLocation(
      value.function,
      `target ${index.toString()} function`,
    ),
    parameters: value.parameters.map((parameter, parameterIndex) =>
      parseLocation(
        parameter,
        `target ${index.toString()} parameter ${parameterIndex.toString()}`,
      ),
    ),
  };
}

function parseLocation(value: unknown, description: string): SourceLocation {
  if (
    !isObject(value) ||
    typeof value.fileLocation !== "string" ||
    value.fileLocation.length === 0 ||
    !Number.isInteger(value.startLine) ||
    !Number.isInteger(value.startColumn) ||
    (value.startLine as number) < 1 ||
    (value.startColumn as number) < 1
  ) {
    throw new TypeError(
      `The ${description} must have a non-empty fileLocation and positive integer startLine and startColumn.`,
    );
  }

  return {
    fileLocation: value.fileLocation,
    startLine: value.startLine as number,
    startColumn: value.startColumn as number,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emitSelectedTypeChecks(
  targets: readonly RuntimeCheckTarget[],
  options: ts.CompilerOptions,
): void {
  const project = createProject(
    targets.flatMap((target) => [
      target.function.fileLocation,
      ...target.parameters.map((parameter) => parameter.fileLocation),
    ]),
    options,
  );
  const checker = project.getTypeChecker();
  const selectedFunctions = new Map<FunctionDeclaration, SelectedFunction>();

  for (const target of targets) {
    const sourceFile = project.getSourceFile(
      resolve(target.function.fileLocation),
    );
    if (sourceFile === undefined) {
      throw new Error(
        `Could not find source file '${target.function.fileLocation}'.`,
      );
    }

    const declaration = sourceFile
      .getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
      .find((candidate) => isAtLocation(candidate, target.function));
    if (declaration === undefined) {
      throw new Error(
        `Could not find a function declaration at ${formatLocation(target.function)}.`,
      );
    }

    let selectedFunction = selectedFunctions.get(declaration);
    if (selectedFunction === undefined) {
      selectedFunction = { declaration, parameters: [] };
      selectedFunctions.set(declaration, selectedFunction);
    }

    for (const parameterLocation of target.parameters) {
      const parameter = declaration
        .getParameters()
        .find((candidate) => isAtLocation(candidate, parameterLocation));
      if (parameter === undefined) {
        throw new Error(
          `Could not find a parameter of the function at ${formatLocation(target.function)} at ${formatLocation(parameterLocation)}.`,
        );
      }
      if (!selectedFunction.parameters.includes(parameter)) {
        selectedFunction.parameters.push(parameter);
      }
    }
  }

  for (const { declaration, parameters } of selectedFunctions.values()) {
    emitRuntimeChecks(declaration, parameters, checker);
  }
}

function isAtLocation(node: Node, location: SourceLocation): boolean {
  if (node.getSourceFile().getFilePath() !== resolve(location.fileLocation)) {
    return false;
  }

  const actual = node.getSourceFile().getLineAndColumnAtPos(node.getStart());
  return (
    actual.line === location.startLine && actual.column === location.startColumn
  );
}

function formatLocation(location: SourceLocation): string {
  return `'${location.fileLocation}:${location.startLine.toString()}:${location.startColumn.toString()}'`;
}

function createProject(
  fileNames: readonly string[],
  options: ts.CompilerOptions,
): Project {
  const project = new Project({
    compilerOptions: options,
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    ...new Set(fileNames.map((name) => resolve(name))),
  ]);
  project.resolveSourceFileDependencies();
  return project;
}

function emitTypeChecks(
  fileNames: string[],
  options: ts.CompilerOptions,
): void {
  const project = createProject(fileNames, options);

  const checker = project.getTypeChecker();

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) {
      continue;
    }

    for (const functionDeclaration of sourceFile.getFunctions()) {
      if (!functionDeclaration.isExported()) {
        continue;
      }

      emitRuntimeChecks(
        functionDeclaration,
        functionDeclaration.getParameters(),
        checker,
      );
    }
  }
}

function emitRuntimeChecks(
  functionDeclaration: FunctionDeclaration,
  parameters: readonly ParameterDeclaration[],
  checker: TypeChecker,
): void {
  const checks = parameters.map((parameter) => {
    const name = parameter.getName();
    const type = resolveType(parameter.getType(), checker, functionDeclaration);
    return { name, type, check: makeCheck(name, type) };
  });

  for (const check of checks) {
    console.log(`if (!(${check.check})) {
    throw new Error(\`TYPE ERROR: Parameter '${check.name}' is of type '${typeToString(check.type)}', but has a value of \${${check.name}}\`)
}`);
  }
}

function resolveType(
  type: Type,
  checker: TypeChecker,
  location: Node,
): ResolvedType {
  // Literal types
  if (type.isBooleanLiteral()) {
    return { kind: "literal", value: type.getText() === "true" };
  }

  if (type.isBigIntLiteral()) {
    const value = type.getLiteralValueOrThrow();

    if (typeof value === "object") {
      return {
        kind: "literal",
        value: BigInt(`${value.negative ? "-" : ""}${value.base10Value}`),
      };
    }

    return { kind: "literal", value: BigInt(value) };
  }

  if (type.isStringLiteral() || type.isNumberLiteral()) {
    const value = type.getLiteralValueOrThrow();

    if (typeof value === "object") {
      throw new Error(
        "Unexpected object returned for string literal or number literal.",
      );
    }

    return { kind: "literal", value };
  }

  if (type.isNull()) {
    return { kind: "literal", value: null };
  }

  if (type.isUndefined()) {
    return { kind: "literal", value: undefined };
  }

  const boxedPrimitiveName = getBoxedPrimitiveName(type, location);
  if (boxedPrimitiveName !== undefined) {
    return { kind: "boxed-primitive", name: boxedPrimitiveName };
  }

  type.getAliasSymbol();

  // Primitive types
  if (
    type.isString() ||
    type.isNumber() ||
    type.isBoolean() ||
    type.isBigInt() ||
    type.isVoid() ||
    type.isNever() ||
    type.isAny() ||
    type.isUnknown()
  ) {
    return { kind: "primitive", name: type.getText() };
  }

  type = type.getApparentType();

  // Union: A | B
  if (type.isUnion()) {
    return {
      kind: "union",
      types: type.getUnionTypes().map((t) => resolveType(t, checker, location)),
    };
  }

  // Intersection: A & B
  if (type.isIntersection()) {
    return {
      kind: "intersection",
      types: type
        .getIntersectionTypes()
        .map((t) => resolveType(t, checker, location)),
    };
  }

  // Tuple: [A, B] or [a: A, b: B]
  if (type.isTuple()) {
    return {
      kind: "tuple",
      elements: type
        .getTupleElements()
        .map((t) => ({ type: resolveType(t, checker, location), rest: false })), // TODO: handle rest
    };
  }

  // Array: string[]
  if (type.isArray()) {
    return {
      kind: "array",
      element: resolveType(
        type.getArrayElementTypeOrThrow(),
        checker,
        location,
      ),
    };
  }

  // Function
  const signatures = type.getCallSignatures();
  if (signatures.length > 0) {
    return {
      kind: "function",
      signatures: signatures.map((s) => ({
        parameters: s.getParameters().map((p) => ({
          name: p.getName(),
          type: resolveSymbol(p, checker, location),
        })),
        returnType: resolveType(s.getReturnType(), checker, location),
      })),
    };
  }

  // Object: { a: A, b: B }
  if (type.isObject()) {
    // TODO: handle cases like `Record<"a" | "b", number>` where`type.getApparentType()` expands it
    // into `{ a: string; b: string }` and the `a` and `b` properties have no source declaration
    // that `Symbol.getValueDeclarationOrThrow()` can access.
    const properties = type.getProperties().map((p) => ({
      name: p.getName(),
      type: resolveSymbol(p, checker, location),
      optional: p.isOptional(),
    }));

    const indices: Index[] = [];

    const stringIndexType = type.getStringIndexType();
    if (stringIndexType !== undefined) {
      indices.push({
        key: "string",
        value: resolveType(stringIndexType, checker, location),
      });
    }

    const numberIndexType = type.getNumberIndexType();
    if (numberIndexType !== undefined) {
      indices.push({
        key: "number",
        value: resolveType(numberIndexType, checker, location),
      });
    }

    if (properties.length > 0 || indices.length > 0) {
      return {
        kind: "object",
        properties,
        indices,
      };
    }
  }

  return { kind: "unsupported", value: type.getText() };
}

function resolveSymbol(
  symbol: Symbol,
  checker: TypeChecker,
  location: Node,
): ResolvedType {
  const declaration = symbol.getValueDeclaration();
  const type = checker.getTypeOfSymbolAtLocation(
    symbol,
    declaration ?? location,
  );
  return resolveType(type, checker, location);
}

function getBoxedPrimitiveName(
  type: Type,
  location: Node,
): BoxedPrimitiveName | undefined {
  const symbol = type.getSymbol();
  if (symbol === undefined) {
    return undefined;
  }

  const name = boxedPrimitiveNames.get(symbol.getName());
  if (name === undefined) {
    return undefined;
  }

  const program = location.getProject().getProgram().compilerObject;
  const isDefaultLibraryType = symbol.getDeclarations().some((declaration) => {
    const sourceFile = declaration.getSourceFile();
    return program.isSourceFileDefaultLibrary(sourceFile.compilerNode);
  });

  return isDefaultLibraryType ? name : undefined;
}
