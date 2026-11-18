/** Reorder visible slots only; hidden tasks and task data retain their identity. */
export function reorderTaskSubset<T extends { id: string }>(
  tasks: T[],
  visibleIds: string[],
  from: string,
  to: string,
): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ids = visibleIds.filter((id) => byId.has(id));
  const source = ids.indexOf(from),
    destination = ids.indexOf(to);
  if (
    source < 0 ||
    destination < 0 ||
    source === destination ||
    new Set(ids).size !== ids.length
  )
    return tasks;
  ids.splice(destination, 0, ...ids.splice(source, 1));
  const slots = new Set(ids);
  const stored = ids.reverse().map((id) => byId.get(id)!);
  let index = 0;
  return tasks.map((task) => (slots.has(task.id) ? stored[index++]! : task));
}
