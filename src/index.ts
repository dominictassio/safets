import ts from "typescript";

const typeStringCache = new WeakMap<ts.Type, string>();
const workingTypeSet = new WeakSet<ts.Type>();

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

function typeToString(type: ts.Type, checker: ts.TypeChecker): string {
  type = normalizeType(type, checker);
  // Preprocess type to handle recursive types and cache results
  const cached = typeStringCache.get(type);
  if (cached !== undefined) {
    return cached;
  }
  
  if (workingTypeSet.has(type)) {
    return "(recursive)";
  }

  workingTypeSet.add(type);

  let result: string | undefined;

  try {
    // String literal: "Hello, World!"
    if (type.isStringLiteral()) {
      result = `"${type.value}"`;
    }

    // Number literal: 42, 3.14, 0xff, 0.255e3
    else if (type.isNumberLiteral()) {
      result = String(type.value);
    }

    // BigInt literal: 9007199254740991n
    else if (isBigIntLiteral(type)) {
      const { negative, base10Value } = type.value;
      result = `${negative ? "-" : ""}${base10Value}n`;
    }

    // Boolean literal: true or false
    else if (type.flags & ts.TypeFlags.BooleanLiteral) {
      result = (type as unknown as { intrinsicName: string }).intrinsicName;
    }

    // Template literal: `+${number} $({number}) ${number}-${number}`
    else if (isTemplateLiteral(type)) {
      const template: ts.TemplateLiteralType = type;
      if (template.texts.length > 0) {
        let templateText = template.texts[0] ?? "";
        template.types.forEach((spanType, i) => {
          templateText += `\${${typeToString(spanType, checker)}}`;
          templateText += template.texts[i + 1] ?? "";
        });
        result = `\`${templateText}\``;
      } else {
        result = "``";
      }
    }

    // Primitive types
    else if (
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
      result = checker.typeToString(type);
    }

    else {
      type = checker.getApparentType(type);

      // Union: A | B
      if (type.isUnion()) {
        result = type.types.map((t) => typeToString(t, checker)).join(" | ");
      }

      // Intersection: A & B
      else if (type.isIntersection()) {
        result = type.types.map((t) => typeToString(t, checker)).join(" & ");
      }

      else if (
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
            const resolved = typeToString(type, checker);
            const label = declarations?.[i];
            if (label) {
              const isRest = !!(label as ts.NamedTupleMember).dotDotDotToken;
              const name = (label as ts.NamedTupleMember).name.getText();
              return isRest ? `...${name}: ${resolved}` : `${name}: ${resolved}`;
            }
            return resolved;
          });

          result = `[${elements.join(", ")}]`;
        }

        // Array: string[], readonly string[], Array<string>
        else if (
          target.symbol.name === "Array" ||
          target.symbol.name === "ReadonlyArray"
        ) {
          result = checker.typeToString(type);
        }
      }

      // Function
      else {
        const signatures = type.getCallSignatures();
        if (signatures.length > 0) {
          result = signatures
            .map((signature) => {
              const parameters = signature
                .getParameters()
                .map((parameter) => {
                  const parameterType = checker.getTypeOfSymbol(parameter);
                  return `${parameter.name}: ${typeToString(parameterType, checker)}`;
                })
                .join(", ");
              const returnType = typeToString(signature.getReturnType(), checker);
              return `(${parameters}) => ${returnType}`;
            })
            .join(" & ");
        }

        // Object: { a: A, b: B}
        else if (type.flags & ts.TypeFlags.Object) {
          const props = type.getProperties().map((prop) => {
            const propType = checker.getTypeOfSymbol(prop);
            return `${prop.name}: ${typeToString(propType, checker)}`;
          });
          // Handle index signatures: [key: string]: V
          const indexSignatures: string[] = [];
          const stringIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
          if (stringIndexType) {
            indexSignatures.push(
              `[key: string]: ${typeToString(stringIndexType, checker)}`,
            );
          }
          // Handle number index signatures: [index: number]: V
          const numberIndexType = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
          if (numberIndexType) {
            indexSignatures.push(
              `[index: number]: ${typeToString(numberIndexType, checker)}`,
            );
          }

          const members = [...props, ...indexSignatures];
          if (members.length > 0) {
            result = `{ ${members.join("; ")} }`;
          }
        }

        if (result === undefined) {
          result = checker.typeToString(type);
        }
      }
    }

    const finalResult = result ?? checker.typeToString(type);
    
    typeStringCache.set(type, finalResult);
    return finalResult;
  } finally {
    workingTypeSet.delete(type);
  }
}
// Normalize only non-generic aliases and type-parameter bounds
function normalizeType(type: ts.Type, checker: ts.TypeChecker): ts.Type {
  const seen = new WeakSet<ts.Type>();
  let current = type;

  while (!seen.has(current)) {
    seen.add(current);

    if (
      current.aliasSymbol &&
      (!current.aliasTypeArguments || current.aliasTypeArguments.length === 0)
    ) {
      const declared = checker.getDeclaredTypeOfSymbol(current.aliasSymbol);
      if (declared !== current) {
        current = declared;
        continue;
      }
    }
  
    if (current.flags & ts.TypeFlags.TypeParameter) { // Type parameter: T extends U
      const constraint = checker.getBaseConstraintOfType(current);
      if (constraint && constraint !== current) {
        current = constraint;
        continue;
      }
    }

    return current;
  }

  return current;
}

function isBigIntLiteral(type: ts.Type): type is ts.BigIntLiteralType {
  return !!(type.flags & ts.TypeFlags.BigIntLiteral);
}

function isTemplateLiteral(type: ts.Type): type is ts.TemplateLiteralType {
  return !!(type.flags & ts.TypeFlags.TemplateLiteral);
}
