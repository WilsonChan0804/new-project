"""Verify the three extension targets and the containment test.

Confirms a T-junction lands on the target's NEAR FACE (not its centreline),
a corner lands on the centreline intersection, and a collinear end-to-end
extension stays on the wall's own axis.
"""
import math
MM = 304.8

def norm(v):
    L = math.hypot(v[0], v[1]); return (v[0]/L, v[1]/L)
def dot(a,b): return a[0]*b[0]+a[1]*b[1]
def lat(pt, base, d):
    n = (-d[1], d[0]); return dot((pt[0]-base[0], pt[1]-base[1]), n)
def isect(p1,d1,p2,d2):
    den = d1[0]*d2[1]-d1[1]*d2[0]
    if abs(den) < 1e-10: return None
    dx,dy = p2[0]-p1[0], p2[1]-p1[1]
    t = (dx*d2[1]-dy*d2[0])/den
    return (p1[0]+d1[0]*t, p1[1]+d1[1]*t)

def target(kind, ep, a, wd, oa, ob, o_thk, mode='face'):
    od = norm((ob[0]-oa[0], ob[1]-oa[1]))
    if kind == 'T' and mode == 'face':
        n = (-od[1], od[0])
        side = 1.0 if lat(ep, oa, od) >= 0 else -1.0
        face = (oa[0]+n[0]*side*o_thk*0.5, oa[1]+n[1]*side*o_thk*0.5)
        return isect(a, wd, face, od)
    ip = isect(a, wd, oa, od)
    if ip is not None: return ip
    d0 = math.hypot(ep[0]-oa[0], ep[1]-oa[1])
    d1 = math.hypot(ep[0]-ob[0], ep[1]-ob[1])
    near = oa if d0 <= d1 else ob
    t = dot((near[0]-a[0], near[1]-a[1]), wd)
    return (a[0]+wd[0]*t, a[1]+wd[1]*t)

thk = 100.0/MM          # 100 mm target wall
gap = 2.9/MM

print("TARGET WALL: 100 mm thick, centreline on the X axis")
print("Near face is therefore 50 mm from the centreline.\n")

# --- T-junction: wall approaching from +Y, stopping 2.9 mm short of the face
oa, ob = (-10.0, 0.0), (10.0, 0.0)
stop_y = thk*0.5 + gap
a  = (0.0, stop_y + 5.0)      # far end
ep = (0.0, stop_y)            # the end with the gap
wd = norm((ep[0]-a[0], ep[1]-a[1]))

tf = target('T', ep, a, wd, oa, ob, thk, 'face')
tc = target('T', ep, a, wd, oa, ob, thk, 'centreline')
print("T-junction  -> face target      y = %+7.2f mm  (move %5.2f mm)"
      % (tf[1]*MM, math.hypot(tf[0]-ep[0], tf[1]-ep[1])*MM))
print("T-junction  -> centreline target y = %+7.2f mm  (move %5.2f mm)"
      % (tc[1]*MM, math.hypot(tc[0]-ep[0], tc[1]-ep[1])*MM))
print("   face target sits exactly on the face: %s"
      % ("YES" if abs(tf[1]-thk*0.5) < 1e-9 else "NO"))
print("   face move equals the reported gap:    %s"
      % ("YES" if abs(math.hypot(tf[0]-ep[0],tf[1]-ep[1])-gap) < 1e-9 else "NO"))
print("   old behaviour buried the wall %.1f mm into the target\n"
      % ((thk*0.5)*MM))

# --- corner: both walls end near each other, mitre at the centrelines
oa, ob = (0.0, 0.0), (0.0, 10.0)
a  = (-6.0, 0.0)
ep = (-gap, 0.0)
wd = norm((ep[0]-a[0], ep[1]-a[1]))
tc = target('C', ep, a, wd, oa, ob, thk)
print("Corner      -> centreline mitre  x = %+7.2f mm  (move %5.2f mm)"
      % (tc[0]*MM, math.hypot(tc[0]-ep[0], tc[1]-ep[1])*MM))
print("   lands on the corner point:  %s\n"
      % ("YES" if abs(tc[0]) < 1e-9 and abs(tc[1]) < 1e-9 else "NO"))

# --- collinear end-to-end, walls laterally offset by 0 -> stays on axis
oa, ob = (5.0, 0.0), (15.0, 0.0)
a  = (-5.0, 0.0)
ep = (5.0-gap, 0.0)
wd = norm((ep[0]-a[0], ep[1]-a[1]))
te = target('E', ep, a, wd, oa, ob, thk)
print("End-to-end  -> own axis          x = %+7.2f mm  (move %5.2f mm)"
      % (te[0]*MM, math.hypot(te[0]-ep[0], te[1]-ep[1])*MM))
print("   stays on the wall's own line (y=0): %s"
      % ("YES" if abs(te[1]) < 1e-9 else "NO"))
