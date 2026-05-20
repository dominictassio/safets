import ts from "typescript";

generateDocumentation(process.argv.slice(2), {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
});

function generateDocumentation(
  fileNames: string[],
  options: ts.CompilerOptions,
): void {
  // Build a program using the set of root file names in fileNames
  const program = ts.createProgram(fileNames, options);
  const checker = program.getTypeChecker();

  // Visit every sourceFile in the program
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      // Walk the tree to search for functions
      ts.forEachChild(sourceFile, visit);
    }
  }

  return;

  /** visit nodes finding exported functions */
  function visit(node: ts.Node) {
    // Only consider exported nodes
    if (!isNodeExported(node)) {
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const symbol = checker.getSymbolAtLocation(node.name);

      if (symbol === undefined) {
        return;
      }

      const type = checker.getTypeOfSymbol(symbol);
      console.log(typeToString(type, checker));
    }
  }

  /** True if this is visible outside this file, false otherwise */
  function isNodeExported(node: ts.Node): boolean {
    return (
      (ts.getCombinedModifierFlags(node as ts.Declaration) &
        ts.ModifierFlags.Export) !==
        0 || node.parent.kind === ts.SyntaxKind.SourceFile
    );
  }
}

function typeToString(
  type: ts.Type,
  checker: ts.TypeChecker,
  visited = new Set<ts.Type>(),
  depth = 5,
): string {
  // String literal: "Hello, World!"
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return `"${(type as ts.StringLiteralType).value}"`;
  }

  // Number literal: 42, 3.14, 0xff, 0.255e3
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return String((type as ts.NumberLiteralType).value);
  }

  // BigInt literal: 9007199254740991n
  if (type.flags & ts.TypeFlags.BigIntLiteral) {
    const { negative, base10Value } = (type as ts.BigIntLiteralType).value;
    return `${negative ? "-" : ""}${base10Value}n`;
  }

  // Boolean literal: true or false
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as any).intrinsicName; // fix
  }

  // NOT WORKING
  // Template literal: `+${number} $({number}) ${number}-${number}`
  if (type.flags & ts.TypeFlags.TemplateLiteral) {
    const template = type as ts.TemplateLiteralType;
    let result = template.texts[0]!;
    template.types.forEach((spanType, i) => {
      result += `\${${typeToString(spanType, checker, visited, depth)}}`;
      result += template.texts[i + 1];
    });
    return `\`${result}\``;
  }

  // Primitive types
  if (
    type.flags &
    (ts.TypeFlags.String |
      ts.TypeFlags.Number |
      ts.TypeFlags.Boolean |
      ts.TypeFlags.BigInt |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void |
      ts.TypeFlags.Never |
      ts.TypeFlags.Any |
      ts.TypeFlags.Unknown)
  ) {
    return checker.typeToString(type);
  }

  type = checker.getApparentType(type);

  // Union: A | B
  if (type.isUnion()) {
    return type.types
      .map((t) => typeToString(t, checker, visited, depth))
      .join(" | ");
  }

  // Intersection: A & B
  if (type.isIntersection()) {
    return type.types
      .map((t) => typeToString(t, checker, visited, depth))
      .join(" & ");
  }

  if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    const reference = type as ts.TypeReference;
    const target = reference.target;

    // Tuple: [A, B] or [a: A, b: B]
    if ((target as ts.ObjectType).objectFlags & ts.ObjectFlags.Tuple) {
      const tuple = target as ts.TupleType;
      const typeArguments = checker.getTypeArguments(reference);
      const declarations = tuple.labeledElementDeclarations;

      const elements = typeArguments.map((type, i) => {
        const resolved = typeToString(type, checker, visited, depth);
        const label = declarations?.[i];
        if (label) {
          const isRest = !!(label as ts.NamedTupleMember).dotDotDotToken;
          const name = (label as ts.NamedTupleMember).name.getText();
          return isRest ? `...${name}: ${resolved}` : `${name}: ${resolved}`;
        }
        return resolved;
      });

      return `[${elements.join(", ")}]`;
    }

    // Array: string[], readonly string[], Array<string>
    if (
      target.symbol.name === "Array" ||
      target.symbol.name === "ReadonlyArray"
    ) {
      const [elementType] = checker.getTypeArguments(reference);
      const resolved = typeToString(elementType!, checker, visited, depth);
      const isReadonly = target.symbol.name === "ReadonlyArray";
      return isReadonly ? `readonly ${resolved}[]` : `${resolved}[]`;
    }
  }

  // Function
  const signatures = type.getCallSignatures();
  if (signatures.length > 0) {
    return signatures
      .map((signature) => {
        const parameters = signature
          .getParameters()
          .map((parameter) => {
            const parameterType = checker.getTypeOfSymbol(parameter);
            return `${parameter.name}: ${typeToString(parameterType, checker, visited, depth)}`;
          })
          .join(", ");
        const returnType = typeToString(
          signature.getReturnType(),
          checker,
          visited,
          depth,
        );
        return `(${parameters}) => ${returnType}`;
      })
      .join(" & ");
  }

  // Object: { a: A, b: B}
  if (type.flags & ts.TypeFlags.Object) {
    const props = type.getProperties().map((prop) => {
      const propType = checker.getTypeOfSymbol(prop);
      return `${prop.name}: ${typeToString(propType, checker, visited, depth)}`;
    });
    if (props.length > 0) {
      return `{ ${props.join("; ")} }`;
    }
  }

  return checker.typeToString(type);
}
