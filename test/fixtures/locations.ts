export function selected(unchecked: number, checked: string): string {
  return unchecked.toString() + checked;
}

export function unselected(value: boolean): boolean {
  return value;
}
