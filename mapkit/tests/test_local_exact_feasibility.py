"""Strict, exact axial routing proofs: boundaries remain part of the contract."""
from fractions import Fraction as F
from itertools import permutations, product
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'experimental_bsp'))
import stratified_csg as proof


class ExactFeasibility(unittest.TestCase):
    def test_open_closed_and_empty_intersections(self):
        for lower_open, upper_open in product((False, True), repeat=2):
            rows = [(1,0,0,2,upper_open), (-1,0,0,-2,lower_open)]
            self.assertEqual(proof._strict_feasible(rows), not (lower_open or upper_open))
        self.assertFalse(proof._strict_feasible([(1,0,0,2,False), (-1,0,0,-3,False)]))
        self.assertTrue(proof._strict_feasible([]))
        self.assertFalse(proof._strict_feasible([(0,0,0,0,True)]))
        self.assertFalse(proof._strict_feasible([(0,0,0,-1,False)]))
        self.assertTrue(proof._strict_feasible([(0,0,0,0,False)]))

    def test_scaled_signed_planes_and_no_epsilon(self):
        tiny = F(1, 2**200)
        for order in permutations([(2,0,0,2,True), (-3,0,0,-3+tiny,True), (0,-5,0,7,False)]):
            self.assertTrue(proof._strict_feasible(order))
        self.assertFalse(proof._strict_feasible([(2,0,0,2,False), (-3,0,0,-3-tiny,False)]))

    def test_points_lines_and_planes_remain_feasible(self):
        rows = []
        for axis in range(3):
            normal = [0]*3
            normal[axis] = 1
            rows.extend([(*normal,axis,False), (*[-v for v in normal],-axis,False)])
            self.assertTrue(proof._strict_feasible(rows))

    def test_oblique_constraints_use_general_solver(self):
        rows = [((F(1),F(1),F(0),F(1)), False)]
        self.assertIsNone(proof._axial_feasible(rows,3))
        self.assertFalse(proof._strict_feasible([(1,1,0,1,False),(-1,0,0,-1,False),(0,-1,0,-1,False)]))
        self.assertTrue(proof._strict_feasible([(1,1,0,1,False),(-1,0,0,0,False),(0,-1,0,0,False)]))

    def test_invalid_coordinates_still_refused(self):
        for value in (True, float('nan'), float('inf'), 2**4097):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(proof.Refused):
                proof._strict_feasible([(value,0,0,1,False)])

    def test_native_axial_signs_include_exact_boundaries(self):
        planes = tuple(tuple(map(F,p)) for p in ((1,0,0,2),(-1,0,0,-2),(0,1,0,-5)))
        self.assertTrue(proof._native_sign_feasible(planes, ((0,0),(1,0),(2,-1))))
        self.assertFalse(proof._native_sign_feasible(planes, ((0,-1),(1,-1))))
        self.assertTrue(proof._native_sign_feasible(planes, ((0,-1),(1,1))))
        self.assertTrue(proof._native_sign_feasible(planes, ()))

    def test_axial_systems_against_exhaustive_sign_cells(self):
        rng = random.Random(28102026)
        for _ in range(300):
            rows = []
            cuts = [set() for _ in range(3)]
            for _ in range(rng.randrange(1,20)):
                axis = rng.randrange(3)
                coefficient = rng.choice((-3,-1,1,2))
                bound = F(rng.randrange(-12,13),rng.randrange(1,5))
                row = [0]*3
                row[axis] = coefficient
                rows.append((*row,bound,bool(rng.randrange(2))))
                cuts[axis].add(bound/coefficient)
            expected = True
            for axis, values in enumerate(cuts):
                points = sorted(values)
                samples = ([points[0]-1,points[-1]+1]+points+
                           [(a+b)/2 for a,b in zip(points,points[1:])]) if points else [F(0)]
                expected &= any(all((r[axis]*x < r[-2] if r[-1] else r[axis]*x <= r[-2])
                                    for r in rows if r[axis]) for x in samples)
            self.assertEqual(proof._strict_feasible(rows), expected)


if __name__ == '__main__':
    unittest.main()
