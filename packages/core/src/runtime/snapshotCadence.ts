/**
 * Single place deciding when run state is persisted as a session snapshot.
 * `every` must be a positive integer (validated at the run boundary).
 */
export function shouldSnapshot(iteration: number, every: number): boolean {
  return iteration % every === 0;
}
