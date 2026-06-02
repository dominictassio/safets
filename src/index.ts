import {
  Project,
  ts,
  type Symbol,
  type Type,
  type TypeChecker,
} from "ts-morph";
import { typeToString, type Index, type ResolvedType } from "./types.ts";

generateDocumentation(process.argv.slice(2), {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
});

function generateDocumentation(
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

      console.log(
        typeToString(resolveType(functionDeclaration.getType(), checker)),
      );
    }
  }
}

function resolveType(type: Type, checker: TypeChecker): ResolvedType {
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
      types: type.getUnionTypes().map((t) => resolveType(t, checker)),
    };
  }

  // Intersection: A & B
  if (type.isIntersection()) {
    return {
      kind: "intersection",
      types: type.getIntersectionTypes().map((t) => resolveType(t, checker)),
    };
  }

  // Tuple: [A, B] or [a: A, b: B]
  if (type.isTuple()) {
    return {
      kind: "tuple",
      elements: type
        .getTupleElements()
        .map((t) => ({ type: resolveType(t, checker), rest: false })), // TODO: handle rest
    };
  }

  // Array: string[]
  if (type.isArray()) {
    return {
      kind: "array",
      element: resolveType(type.getArrayElementTypeOrThrow(), checker),
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
          type: resolveSymbol(p, checker),
        })),
        returnType: resolveType(s.getReturnType(), checker),
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
      type: resolveSymbol(p, checker),
      optional: p.isOptional(),
    }));

    const indices: Index[] = [];

    const stringIndexType = type.getStringIndexType();
    if (stringIndexType !== undefined) {
      indices.push({
        key: "string",
        value: resolveType(stringIndexType, checker),
      });
    }

    const numberIndexType = type.getNumberIndexType();
    if (numberIndexType !== undefined) {
      indices.push({
        key: "number",
        value: resolveType(numberIndexType, checker),
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

function resolveSymbol(symbol: Symbol, checker: TypeChecker): ResolvedType {
  return resolveType(getTypeOfSymbol(symbol, checker), checker);
}

function getTypeOfSymbol(symbol: Symbol, checker: TypeChecker): Type {
  const declaration = symbol.getValueDeclarationOrThrow();
  return checker.getTypeOfSymbolAtLocation(symbol, declaration);
}
