type Type =
  | { kind: "primitive"; name: string }
  | { kind: "literal"; value: string | number | bigint | boolean }
  | { kind: "union"; types: Type[] }
  | { kind: "intersection"; types: Type[] }
  | { kind: "array"; element: Type; readonly: boolean }
  | { kind: "tuple"; elements: TupleElement[] }
  | { kind: "object"; properties: Property[] }
  | { kind: "function"; signatures: Signature[] }
  | { kind: "template"; texts: readonly string[]; spans: Type[] }
  | { kind: "unknown"; fallback: string };

interface TupleElement {
  label?: string;
  type: Type;
  rest: boolean;
}

interface Property {
  name: string;
  type: Type;
  optional: boolean;
}

interface Signature {
  parameters: { name: string; type: Type }[];
  returnType: Type;
}
