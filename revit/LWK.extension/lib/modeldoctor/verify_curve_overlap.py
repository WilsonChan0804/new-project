"""Brute-force check of the collinear-overlap grouping and interval maths.

Confirms that (a) a line and its reverse land in the same bucket, (b) segments
on the same infinite line group together regardless of where they sit, and
(c) parallel-but-offset lines never group. Pure Python, no Revit.
"""
import math, random

EPS = 1e-9

def norm(v):
    L = math.sqrt(sum(c*c for c in v))
    return tuple(c/L for c in v)

def dot(a,b): return sum(x*y for x,y in zip(a,b))
def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def add(a,b): return tuple(x+y for x,y in zip(a,b))
def mul(v,s): return tuple(x*s for x in v)
def neg(v):   return tuple(-x for x in v)

def snap(v, tol): return int(round(v/tol))

def line_key(a, b, tol):
    d = norm(sub(b,a))
    if (d[0] < -EPS or (abs(d[0])<=EPS and d[1] < -EPS)
            or (abs(d[0])<=EPS and abs(d[1])<=EPS and d[2] < 0)):
        d = neg(d)
    t = -dot(a,d)
    foot = add(a, mul(d,t))
    return ((snap(foot[0],tol), snap(foot[1],tol), snap(foot[2],tol)),
            (snap(d[0],tol*0.01), snap(d[1],tol*0.01), snap(d[2],tol*0.01))), d

TOL = 1.0/304.8   # 1 mm in feet

def run():
    random.seed(3)
    same_line_ok = reversed_ok = offset_ok = 0
    trials = 400
    for _ in range(trials):
        ang = random.uniform(0, math.pi)
        d = (math.cos(ang), math.sin(ang), 0.0)
        origin = (random.uniform(-50,50), random.uniform(-50,50), 0.0)
        # two segments at different places on the SAME infinite line
        t0, t1 = sorted((random.uniform(-30,30), random.uniform(-30,30)))
        t2, t3 = sorted((random.uniform(-30,30), random.uniform(-30,30)))
        A0, A1 = add(origin, mul(d,t0)), add(origin, mul(d,t1))
        B0, B1 = add(origin, mul(d,t2)), add(origin, mul(d,t3))
        ka,_ = line_key(A0,A1,TOL); kb,_ = line_key(B0,B1,TOL)
        if ka == kb: same_line_ok += 1
        # reversed direction must match
        kr,_ = line_key(B1,B0,TOL)
        if ka == kr: reversed_ok += 1
        # offset perpendicular by 10 mm must NOT match
        n = (-d[1], d[0], 0.0)
        off = mul(n, 10.0/304.8)
        kc,_ = line_key(add(B0,off), add(B1,off), TOL)
        if ka != kc: offset_ok += 1

    print("same infinite line grouped:      %d/%d" % (same_line_ok, trials))
    print("reversed direction grouped:      %d/%d" % (reversed_ok, trials))
    print("10 mm offset correctly separate: %d/%d" % (offset_ok, trials))

    # interval overlap sanity
    print("\ninterval cases (lo,hi vs lo,hi -> overlap, contained?):")
    for a0,a1,b0,b1 in ((0,10,2,8),(0,10,5,15),(0,10,10,20),(0,10,-5,5)):
        ov = min(a1,b1)-max(a0,b0)
        contained = b0>=a0 and b1<=a1
        rev = a0>=b0 and a1<=b1
        print("  A[%d,%d] B[%d,%d] -> overlap %3d  contained=%s reverse=%s"
              % (a0,a1,b0,b1,ov,contained,rev))

run()
