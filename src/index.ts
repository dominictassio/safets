import {
  Node,
  Project,
  ts,
  type Symbol,
  type Type,
  type TypeChecker,
} from "ts-morph";
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

emitTypeChecks(process.argv.slice(2), {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
});

function emitTypeChecks(
  fileNames: string[],
  options: ts.CompilerOptions,
): void {
  const project = new Project({
    compilerOptions: options,
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths(fileNames);
  project.resolveSourceFileDependencies();

  const checker = project.getTypeChecker();

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) {
      continue;
    }

    for (const functionDeclaration of sourceFile.getFunctions()) {
      if (!functionDeclaration.isExported()) {
        continue;
      }

      const withChecks = functionDeclaration.setBodyText((writer) => {
        functionDeclaration.getParameters().map((p) => {
          const name = p.getName();
          const type = resolveType(p.getType(), checker, functionDeclaration);
          const check = makeCheck(name, type);

          writer.write(`if (!(${check}))`).block(() => {
            writer.writeLine(
              `throw new Error(\`TYPE ERROR: Parameter '${name}' is of type '${typeToString(type)}', but has a value of \${${name}}\`)`,
            );
          });
        });

        writer.write(functionDeclaration.getBodyText() ?? "");
      });

      console.log(withChecks.getText());
    }
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
