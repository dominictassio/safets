interface Person {
  first: string;
  last: string;

  toString: () => string;
}

type Name = [first: string, last: string];

type Names = Name[];

type Aged = { name: string; age: number };

class Researcher {
  constructor(
    private name: string,
    private institution: string,
  ) {}

  toString(): string {
    return `${this.name} at ${this.institution}`;
  }
}

class GradStudent {
  constructor(public name: string) {}
}

class GRA extends GradStudent {
  constructor(
    name: string,
    public lab: string,
  ) {
    super(name);
  }
}

interface Parts {
  [key: string]: string;
}

type Phone = `+${number} (${number}) ${number}-${number}`;

type Box<T> = { value: T };

type Who =
  | Box<string>
  | Phone
  | Parts
  | Record<string, string>
  | Record<"a" | "b", number>
  | Researcher
  | GRA
  | Person
  | Name
  | Names
  | { name: string; age: number }
  | Aged
  | string
  | readonly string[]
  | Array<string>
  | ``
  | `+${number} (${number}) ${number}-${number}`
  | "World";

export function greet(who: Who) {
  console.log(`Hello, ${who}!`);
}

export function tuple(t: [string, ...Array<number>, string]) {}
