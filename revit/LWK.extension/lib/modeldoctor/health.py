# -*- coding: utf-8 -*-
"""Model health scoring.

Every check gets an equal share of the 100 points and keeps the fraction of
its own population that is clean:

    share_c  = 100 x factor_c / sum(factor)
    score_c  = (1 - open_issues_c / elements_c) x share_c
    score    = sum(score_c)

With equal factors and ten checks this is exactly (pop - issues) / pop * 10
per check, summed. A model with 144 findings across 1913 lines loses 0.75 of
its 10 points for that check rather than being marked down as if every
finding were a catastrophe -- which is the point: the number has to be
something a modeller can look at without despairing.

Accepted findings and run notices ("no floors found") are excluded from the
issue count. Checks that errored or examined nothing are dropped from the
share calculation entirely, so the remaining checks still total 100.
"""

GRADES = [
    (90.0, 'A', 'Healthy',           '#2E9E5B'),
    (80.0, 'B', 'Minor issues',      '#7FBF3F'),
    (70.0, 'C', 'Needs attention',   '#E8A93A'),
    (60.0, 'D', 'Poor',              '#E1712F'),
    (0.0,  'F', 'Critical',          '#C4382E'),
]


def countable(issues):
    """Findings that count against the score."""
    return [i for i in issues if not i.accepted and not i.scoreless]


def affected_elements(issues):
    """How many distinct elements are implicated.

    Scoring on the raw finding count breaks when one element can generate
    several findings: a line lying inside three others produces three pairs,
    so a check can report more findings than the model has elements and the
    ratio exceeds 1. Counting the elements actually affected keeps the number
    bounded and means the same thing to a modeller: "how much of my model is
    wrong", not "how many pair comparisons failed".
    """
    return len(set(i.primary_id for i in issues))


def model_health(checks):
    scoring = [c for c in checks if c.error is None and c.population > 0]
    total_factor = sum(float(c.score_factor) for c in scoring)

    per_check = []
    total_open = 0
    total_accepted = 0
    score = 0.0

    for c in checks:
        open_issues = countable(c.issues)
        accepted_n = len([i for i in c.issues if i.accepted])
        total_open += len(open_issues)
        total_accepted += accepted_n

        if c in scoring and total_factor > 0:
            share = 100.0 * float(c.score_factor) / total_factor
            clean = 1.0 - (affected_elements(open_issues) /
                           float(c.population))
            if clean < 0.0:
                clean = 0.0
            earned = clean * share
        else:
            share = 0.0
            earned = 0.0
        score += earned

        per_check.append({
            'id': c.id,
            'title': c.title,
            'share': share,
            'earned': earned,
            'lost': share - earned,
            'issues': len(open_issues),
            'affected': affected_elements(open_issues),
            'accepted': accepted_n,
            'population': c.population,
            'error': c.error,
            'elapsed': c.elapsed,
        })

    score = max(0.0, min(100.0, score))
    grade, label, colour = 'F', 'Critical', '#C4382E'
    for threshold, g, lbl, col in GRADES:
        if score >= threshold:
            grade, label, colour = g, lbl, col
            break

    return {
        'score': score,
        'lost': 100.0 - score,
        'grade': grade,
        'label': label,
        'colour': colour,
        'issues': total_open,
        'accepted': total_accepted,
        'checks': per_check,
    }
