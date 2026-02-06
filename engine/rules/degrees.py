"""Degree-of-success rules."""

from __future__ import annotations

from typing import Literal

Degree = Literal["critical_success", "success", "failure", "critical_failure"]


def degree_of_success(total: int, dc: int, die_value: int | None = None) -> Degree:
    if total >= dc + 10:
        degree: Degree = "critical_success"
    elif total >= dc:
        degree = "success"
    elif total <= dc - 10:
        degree = "critical_failure"
    else:
        degree = "failure"

    if die_value == 20:
        if degree == "critical_failure":
            return "failure"
        if degree == "failure":
            return "success"
        if degree == "success":
            return "critical_success"
    elif die_value == 1:
        if degree == "critical_success":
            return "success"
        if degree == "success":
            return "failure"
        if degree == "failure":
            return "critical_failure"
    return degree
