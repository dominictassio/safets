interface Person {
  first: string;
  last: string;

  toString: () => string;
}

type Name = [first: string, last: string];

type Names = Name[];

type Box<T> = {
  value: T;
  label?: string;
};

type Directory<T> = Record<string, Box<T>>;

type Maybe<T> = T | null | undefined;

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

type Phone = `+${number} (${number}) ${number}-${number}`;

type Who =
  | Phone
  | Record<string, string>
  | Researcher
  | GRA
  | Person
  | Name
  | Names
  | { name: string; age: number }
  | string
  | readonly string[]
  | Array<string>
  | "World";

type ContactDirectory = Directory<Person | Researcher | Name>;

type CallableLookup = {
  (value: string): string;
  tags: Record<string, string>;
};

export interface Node {
  next?: Node;
}

export function greet(who: Who) {
  console.log(`Hello, ${who}!`);
}

export function summarizeContacts(
  contacts: ContactDirectory,
): Maybe<Box<Names>> {
  const firstContact = Object.values(contacts)[0];
  return firstContact?.value instanceof Array ? firstContact : undefined;
}

export function lookupCallable(handler: CallableLookup) {
  return handler;
}

export function demo(node: Node) {
  return node;
}