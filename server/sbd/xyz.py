# -*- coding: utf-8 -*-
"""A stand-in for Revit's XYZ: the few operations the SBD modules use."""

import math


class XYZ(object):
    __slots__ = ("X", "Y", "Z")

    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.X = float(x)
        self.Y = float(y)
        self.Z = float(z)

    def __add__(self, o):
        return XYZ(self.X + o.X, self.Y + o.Y, self.Z + o.Z)

    def __sub__(self, o):
        return XYZ(self.X - o.X, self.Y - o.Y, self.Z - o.Z)

    def __mul__(self, k):
        return XYZ(self.X * k, self.Y * k, self.Z * k)

    __rmul__ = __mul__

    def __truediv__(self, k):
        return XYZ(self.X / k, self.Y / k, self.Z / k)

    def __neg__(self):
        return XYZ(-self.X, -self.Y, -self.Z)

    def DistanceTo(self, o):
        return math.sqrt((self.X - o.X) ** 2 + (self.Y - o.Y) ** 2 + (self.Z - o.Z) ** 2)

    def GetLength(self):
        return math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)

    def DotProduct(self, o):
        return self.X * o.X + self.Y * o.Y + self.Z * o.Z

    def Normalize(self):
        n = self.GetLength()
        return XYZ(self.X / n, self.Y / n, self.Z / n) if n > 1e-12 else XYZ(self.X, self.Y, self.Z)

    def __repr__(self):
        return "XYZ(%.4f, %.4f, %.4f)" % (self.X, self.Y, self.Z)
