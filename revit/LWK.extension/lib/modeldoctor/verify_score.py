"""Compare the old and new scoring on Wilson's actual reported numbers."""

class Chk(object):
    def __init__(self, cid, issues, pop, factor, sev=2):
        self.id=cid; self.n=issues; self.population=pop
        self.score_factor=factor; self.error=None
        self.issues=[type('I',(),{'accepted':False,'scoreless':False,
                                  'severity':sev})() for _ in range(issues)]

# Reported in the v0.9.2 screenshot: 278 issues -> F 55/100
checks = [
    Chk('duplicates',      68, 3237, 100.0),
    Chk('curve_overlaps', 133, 4000,  60.0),
    Chk('wall_gaps',       63,  483, 100.0),
    Chk('wall_overlaps',   14,  483, 120.0),
]

print("check            issues / elements    ratio    factor   penalty")
total=0.0
for c in checks:
    ratio=c.n/float(c.population)
    pen=min(ratio*c.score_factor, c.score_factor)
    total+=pen
    print("%-16s %5d / %5d    %6.2f%%  %6.0f   %6.2f"
          % (c.id, c.n, c.population, ratio*100, c.score_factor, pen))
print("-"*60)
print("total penalty %.2f  ->  score %.0f / 100" % (total, max(0,100-total)))

def grade(s):
    for t,g in ((90,'A'),(80,'B'),(70,'C'),(60,'D'),(0,'F')):
        if s>=t: return g
print("grade:", grade(100-total), " (was F 55/100 under the old scheme)")

print("\nEffect of accepting findings:")
for acc in (0, 50, 100, 150):
    t=0.0
    left=acc
    for c in checks:
        take=min(left, c.n); left-=take
        t+=min((c.n-take)/float(c.population)*c.score_factor, c.score_factor)
    print("  %3d accepted -> score %5.1f  grade %s" % (acc, 100-t, grade(100-t)))
