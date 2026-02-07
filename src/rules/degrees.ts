/**
 * Degree-of-success rules.
 * Mirrors engine/rules/degrees.py
 *
 * Pathfinder 2e ORC rules: critical success/failure shifts on natural 1/20.
 */

export type Degree = "critical_success" | "success" | "failure" | "critical_failure";

export function degreeOfSuccess(total: number, dc: number, dieValue?: number): Degree {
  let degree: Degree;

  if (total >= dc + 10) {
    degree = "critical_success";
  } else if (total >= dc) {
    degree = "success";
  } else if (total <= dc - 10) {
    degree = "critical_failure";
  } else {
    degree = "failure";
  }

  if (dieValue === 20) {
    if (degree === "critical_failure") return "failure";
    if (degree === "failure") return "success";
    if (degree === "success") return "critical_success";
  } else if (dieValue === 1) {
    if (degree === "critical_success") return "success";
    if (degree === "success") return "failure";
    if (degree === "failure") return "critical_failure";
  }

  return degree;
}
