export type ResolvedType =
  | PrimitiveType
  | BoxedPrimitiveType
  | LiteralType
  | UnionType
  | IntersectionType
  | ArrayType
  | TupleType
  | ObjectType
  | FunctionType
  | TemplateLiteralType
  | Unsupported;

export interface PrimitiveType {
  kind: "primitive";
  name: string;
}

export type BoxedPrimitiveName =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol";

export interface BoxedPrimitiveType {
  kind: "boxed-primitive";
  name: BoxedPrimitiveName;
}

export interface LiteralType {
  kind: "literal";
  value: string | number | bigint | boolean | null | undefined;
}

export interface UnionType {
  kind: "union";
  types: readonly ResolvedType[];
}

export interface IntersectionType {
  kind: "intersection";
  types: readonly ResolvedType[];
}

export interface ArrayType {
  kind: "array";
  element: ResolvedType;
}

export interface TupleType {
  kind: "tuple";
  elements: readonly TupleElement[];
}

export interface TupleElement {
  type: ResolvedType;
  rest: boolean;
}

export interface ObjectType {
  kind: "object";
  properties: readonly Property[];
  indices: readonly Index[];
}

export interface Index {
  key: "string" | "number" | "symbol";
  value: ResolvedType;
}

export interface Property {
  name: string;
  type: ResolvedType;
  optional: boolean;
}

export interface FunctionType {
  kind: "function";
  signatures: readonly Signature[];
}

export interface Signature {
  parameters: readonly Parameter[];
  returnType: ResolvedType;
}

export interface Parameter {
  name: string;
  type: ResolvedType;
}

export interface TemplateLiteralType {
  kind: "template";
  texts: readonly string[];
  spans: ResolvedType[];
}

export interface Unsupported {
  kind: "unsupported";
  value: string;
}

export function typeToString(type: ResolvedType): string {
  switch (type.kind) {
    case "literal":
      if (type.value === null) {
        return "null";
      }
      if (type.value === undefined) {
        return "undefined";
      }
      return type.value.toString();
    case "template":
      return "`...`";
    case "primitive":
      return type.name;
    case "boxed-primitive":
      return boxedPrimitiveDisplayName(type.name);
    case "union":
      return type.types.map(typeToString).join(" | ");
    case "intersection":
      return type.types.map(typeToString).join(" & ");
    case "tuple":
      return `[${type.elements.map(({ type }) => typeToString(type)).join(", ")}]`;
    case "array":
      return `${typeToString(type.element)}[]`;
    case "function":
      return type.signatures.map(signatureToString).join(" | ");
    case "object":
      return [
        "{",
        [
          ...type.properties.map(propertyToString),
          ...type.indices.map(indexToString),
        ].join("; "),
        "}",
      ].join(" ");
    case "unsupported":
      return `UNSUPPORTED: ${type.value}`;
  }
}

function signatureToString(signature: Signature): string {
  const parameterTexts = signature.parameters.map(parameterToString);
  const returnTypeText = typeToString(signature.returnType);
  return `(${parameterTexts.join(", ")}) => ${returnTypeText}`;
}

function parameterToString(parameter: Parameter): string {
  return `${parameter.name}: ${typeToString(parameter.type)}`;
}

function propertyToString(property: Property): string {
  return `${property.name}${property.optional ? "?" : ""}: ${typeToString(property.type)}`;
}

function indexToString(index: Index): string {
  return `[key: ${index.key}]: ${typeToString(index.value)}`;
}

export function makeCheck(parameter: string, type: ResolvedType): string {
  switch (type.kind) {
    case "literal":
      if (type.value === null) {
        return `${parameter} === null`;
      }
      if (type.value === undefined) {
        return `${parameter} === undefined`;
      }
      if (typeof type.value === "bigint") {
        return `${parameter} === ${type.value.toString()}n`;
      }
      return `${parameter} === ${type.value.toString()}`;

    case "template":
      return "true";

    case "primitive":
      if (type.name === "void") {
        return `(${parameter} === null || ${parameter} === undefined)`;
      }
      if (type.name === "never") {
        return "false";
      }
      if (type.name === "any" || type.name === "unknown") {
        return "true";
      }
      return `typeof ${parameter} === "${type.name}"`;

    case "boxed-primitive":
      return `Object.prototype.toString.call(${parameter}) === "[object ${boxedPrimitiveDisplayName(type.name)}]"`;

    case "union": {
      const typeChecks = type.types.map((t) => makeCheck(parameter, t));
      return `(${typeChecks.join(" || ")})`;
    }

    case "intersection": {
      const typeChecks = type.types.map((t) => makeCheck(parameter, t));
      return `(${typeChecks.join(" && ")})`;
    }

    case "tuple": {
      const typeChecks = type.elements.map((e, i) =>
        makeCheck(`${parameter}[${i.toString()}]`, e.type),
      );
      return `(${typeChecks.join(" && ")})`;
    }

    case "array":
      return `(Array.isArray(${parameter}) && ${parameter}.every((e) => ${makeCheck("e", type.element)}))`;

    case "function":
      return `typeof ${parameter} === "function"`;

    case "object": {
      const typeChecks = type.properties.map((p) =>
        p.optional
          ? `(${parameter}["${p.name}"] === undefined || ${makeCheck(`${parameter}["${p.name}"]`, p.type)})`
          : makeCheck(`${parameter}["${p.name}"]`, p.type),
      );
      return `(${[`typeof ${parameter} === "object"`, ...typeChecks].join(" && ")})`;
    }

    case "unsupported":
      return "false";
  }
}

function boxedPrimitiveDisplayName(name: BoxedPrimitiveName): string {
  switch (name) {
    case "string":
      return "String";
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    case "bigint":
      return "BigInt";
    case "symbol":
      return "Symbol";
  }
}
