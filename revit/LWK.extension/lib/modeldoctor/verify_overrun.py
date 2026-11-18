"""Brute-force check of the corrected over-run formula.

Pure Python, no Revit. Builds wall pairs with a KNOWN over-run, runs the same
algebra used in WallOverlapCheck._measure, and compares. Also samples points
along the victim to confirm independently how far it penetrates the keeper.

Run:  python3 verify_overrun.py
"""
import math
import random

MIN_SIN = 0.10


def norm(v):
    L = math.hypot(v[0], v[1])
    return (v[0] / L, v[1] / L)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def line_intersection(p1, d1, p2, d2):
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-10:
        return None
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    t = (dx * d2[1] - dy * d2[0]) / den
    return (p1[0] + d1[0] * t, p1[1] + d1[1] * t)


def measure(v_p0, v_p1, k_p0, k_p1, k_thk):
    """The formula as implemented in _measure(), trim_to='face'."""
    vd = norm((v_p1[0] - v_p0[0], v_p1[1] - v_p0[1]))
    kd = norm((k_p1[0] - k_p0[0], k_p1[1] - k_p0[1]))
    L = math.hypot(v_p1[0] - v_p0[0], v_p1[1] - v_p0[1])
    ip = line_intersection(v_p0, vd, k_p0, kd)
    if ip is None:
        return None
    t_ip = dot((ip[0] - v_p0[0], ip[1] - v_p0[1]), vd)
    cosang = min(1.0, abs(dot(vd, kd)))
    s = max(math.sin(math.acos(cosang)), MIN_SIN)
    setback = (k_thk * 0.5) / s
    if abs(t_ip) < abs(t_ip - L):
        return ((t_ip + setback) - 0.0, 0)
    return (L - (t_ip - setback), 1)


def brute_penetration(v_p0, v_p1, k_p0, k_p1, k_thk, end_i, samples=400000):
    """Independently: how much of the victim's axis lies inside the keeper's
    slab, measured from the over-running end inward."""
    vd = norm((v_p1[0] - v_p0[0], v_p1[1] - v_p0[1]))
    kd = norm((k_p1[0] - k_p0[0], k_p1[1] - k_p0[1]))
    kn = (-kd[1], kd[0])
    L = math.hypot(v_p1[0] - v_p0[0], v_p1[1] - v_p0[1])
    half = k_thk * 0.5

    inside = []
    for i in range(samples + 1):
        t = L * i / float(samples)
        pt = (v_p0[0] + vd[0] * t, v_p0[1] + vd[1] * t)
        lat = dot((pt[0] - k_p0[0], pt[1] - k_p0[1]), kn)
        if abs(lat) <= half:
            inside.append(t)
    if not inside:
        return 0.0
    if end_i == 0:
        return max(inside) - 0.0 if min(inside) < 1e-9 else 0.0
    return L - min(inside) if max(inside) > L - 1e-9 else 0.0


def run():
    random.seed(7)
    worst = 0.0
    cases = 0
    for _ in range(300):
        # keeper: a wall through the origin at a random bearing
        ka = random.uniform(0, math.pi)
        kd = (math.cos(ka), math.sin(ka))
        k_p0 = (-8.0 * kd[0], -8.0 * kd[1])
        k_p1 = (8.0 * kd[0], 8.0 * kd[1])
        k_thk = random.uniform(0.15, 0.9)      # feet

        # victim: crosses at a decent angle, ending a known amount past the
        # keeper's FAR face measured along its own axis
        rel = random.uniform(math.radians(25), math.radians(155))
        va = ka + rel
        vd = (math.cos(va), math.sin(va))
        s = max(abs(math.sin(rel)), MIN_SIN)
        setback = (k_thk * 0.5) / s

        overrun_true = random.uniform(0.01, 1.2)
        # p1 end over-runs: it should stop at -setback from the crossing,
        # instead it stops at (-setback + overrun_true)
        stop_t = -setback + overrun_true
        start_t = stop_t - random.uniform(4.0, 9.0)
        v_p0 = (vd[0] * start_t, vd[1] * start_t)
        v_p1 = (vd[0] * stop_t, vd[1] * stop_t)

        got = measure(v_p0, v_p1, k_p0, k_p1, k_thk)
        if got is None:
            continue
        overrun_calc, end_i = got
        err = abs(overrun_calc - overrun_true)
        worst = max(worst, err)
        cases += 1
        if err > 1e-9:
            print('MISMATCH true=%.6f calc=%.6f end=%d' %
                  (overrun_true, overrun_calc, end_i))

    print('formula vs construction: %d cases, worst error %.3e ft (%.2e mm)'
          % (cases, worst, worst * 304.8))

    # independent sampled cross-check on a handful of cases
    print('\nsampled cross-check (penetration measured by point sampling):')
    for k_thk, rel_deg, overrun_true in ((0.328, 90.0, 0.164),
                                         (0.328, 45.0, 0.400),
                                         (0.656, 60.0, 0.050)):
        rel = math.radians(rel_deg)
        kd = (1.0, 0.0)
        k_p0, k_p1 = (-8.0, 0.0), (8.0, 0.0)
        vd = (math.cos(rel), math.sin(rel))
        s = max(abs(math.sin(rel)), MIN_SIN)
        setback = (k_thk * 0.5) / s
        stop_t = -setback + overrun_true
        start_t = stop_t - 6.0
        v_p0 = (vd[0] * start_t, vd[1] * start_t)
        v_p1 = (vd[0] * stop_t, vd[1] * stop_t)
        calc, end_i = measure(v_p0, v_p1, k_p0, k_p1, k_thk)
        brute = brute_penetration(v_p0, v_p1, k_p0, k_p1, k_thk, end_i)
        print('  thk=%.3f ang=%4.1f  true=%.4f  formula=%.4f  sampled=%.4f'
              % (k_thk, rel_deg, overrun_true, calc, brute))

    # regression: the OLD formula on the same input
    print('\nold formula on a 50 mm over-run (should have returned 0.0):')
    k_thk = 0.328
    stop = k_thk * 0.5
    for near in (0.0, 0.164, 0.328, 0.5):
        old = max(0.0, stop - near) if near < stop else 0.0
        print('  endpoint %6.1f mm from intersection -> old reported %5.1f mm'
              % (near * 304.8, old * 304.8))


if __name__ == '__main__':
    run()
