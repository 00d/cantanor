from __future__ import annotations

import unittest

from engine.grid.areas import cone_points, line_points, radius_points


class TestTargetingAreas(unittest.TestCase):
    def test_radius_points_contains_center_and_adjacent(self) -> None:
        area = set(radius_points(2, 2, 1))
        self.assertIn((2, 2), area)
        self.assertIn((2, 1), area)
        self.assertIn((1, 2), area)
        self.assertNotIn((3, 3), area)

    def test_line_points_returns_endpoints(self) -> None:
        pts = line_points(0, 0, 3, 0)
        self.assertEqual(pts[0], (0, 0))
        self.assertEqual(pts[-1], (3, 0))
        self.assertEqual(len(pts), 4)

    def test_cone_points_faces_toward_target(self) -> None:
        pts = set(cone_points(origin_x=5, origin_y=5, facing_x=8, facing_y=5, length_tiles=3))
        self.assertIn((6, 5), pts)
        self.assertIn((7, 6), pts)
        self.assertNotIn((5, 7), pts)
        self.assertNotIn((4, 5), pts)


if __name__ == "__main__":
    unittest.main()
