export function fits(orderWeight: number, usedWeight: number, capacity: number): boolean {
  return usedWeight + orderWeight <= capacity;
}
