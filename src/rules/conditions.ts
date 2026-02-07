/**
 * Condition mutation helpers.
 * Mirrors engine/rules/conditions.py
 *
 * Pathfinder 2e ORC conditions: tracked as {name: value} where value is
 * usually a numeric severity (e.g. frightened 2).
 */

export function normalizeConditionName(name: string): string {
  return name.toLowerCase().replace(/ /g, "_");
}

export function conditionIsImmune(
  name: string,
  conditionImmunities: string[],
): boolean {
  const normalized = normalizeConditionName(name);
  const immunitySet = new Set(conditionImmunities.map(normalizeConditionName));
  return immunitySet.has(normalized) || immunitySet.has("all_conditions");
}

export function applyCondition(
  conditions: Record<string, number>,
  name: string,
  value = 1,
): Record<string, number> {
  const result = { ...conditions };
  const key = normalizeConditionName(name);
  const current = result[key] ?? 0;
  result[key] = Math.max(current, value);
  return result;
}

export function clearCondition(
  conditions: Record<string, number>,
  name: string,
): Record<string, number> {
  const result = { ...conditions };
  const key = normalizeConditionName(name);
  delete result[key];
  return result;
}
