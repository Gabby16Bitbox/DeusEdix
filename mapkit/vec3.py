"""3D vectors for the map tools: Vec3, an immutable (x, y, z) with the operators of vector maths.

A Vec3 is a tuple: it indexes, unpacks, hashes, compares and goes to JSON like the plain (x, y, z) tuples
the tools pass around, so a function can take either. The other operand of an operator can be any three
numbers (a tuple, a list, a Vec3). It works with any number type: floats for the brushes, Fractions for the
exact checks of experimental_bsp.

    n = (b - a).cross(c - a).normalized()
    d = n.dot(p) - w
"""
import math
from typing import NamedTuple


class Vec3(NamedTuple):
    x: float
    y: float
    z: float

    @classmethod
    def of(cls, v):
        """Any three numbers as a Vec3."""
        return v if type(v) is cls else cls(v[0], v[1], v[2])

    def __add__(self, o):
        return Vec3(self.x + o[0], self.y + o[1], self.z + o[2])

    __radd__ = __add__              # (x, y, z) + Vec3 adds too (a tuple would join them)

    def __sub__(self, o):
        return Vec3(self.x - o[0], self.y - o[1], self.z - o[2])

    def __rsub__(self, o):
        return Vec3(o[0] - self.x, o[1] - self.y, o[2] - self.z)

    def __mul__(self, k):
        return Vec3(self.x * k, self.y * k, self.z * k)

    __rmul__ = __mul__

    def __truediv__(self, k):
        return Vec3(self.x / k, self.y / k, self.z / k)

    def __neg__(self):
        return Vec3(-self.x, -self.y, -self.z)

    def dot(self, o):
        return self.x * o[0] + self.y * o[1] + self.z * o[2]

    def cross(self, o):
        return Vec3(self.y * o[2] - self.z * o[1], self.z * o[0] - self.x * o[2], self.x * o[1] - self.y * o[0])

    def length_squared(self):
        return self.dot(self)

    def length(self):
        return math.sqrt(self.dot(self))

    def normalized(self):
        """The unit vector of the same direction; (0, 0, 0) for a vector shorter than 1e-9."""
        n = self.length()
        return Vec3(self.x / n, self.y / n, self.z / n) if n > 1e-9 else Vec3(0.0, 0.0, 0.0)
