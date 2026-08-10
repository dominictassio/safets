export function boxed(
  stringValue: String,
  numberValue: Number,
  booleanValue: Boolean,
  bigintValue: BigInt,
  symbolValue: Symbol,
) {}

export namespace Custom {
  export interface String {
    value: string;
  }
}

export function customString(value: Custom.String) {}
