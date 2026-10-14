"""A stand-in for the parts of Revit's API the SBD engine uses outside Revit."""
from sbd.xyz import XYZ  # noqa: F401


class Line(object):
    """Only made by Revit drawing helpers, which the server never calls."""

    @staticmethod
    def CreateBound(a, b):
        raise RuntimeError("Revit Line is not available on the server")
