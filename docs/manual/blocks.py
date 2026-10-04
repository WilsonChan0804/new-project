"""The kinds of block a manual is written in (content_en.py, content_yue.py).

Inline **bold** marks a bold lead-in, as in the original manual."""


def H1(t): return ("H1", t)
def H2(t): return ("H2", t)
def H3(t): return ("H3", t)
def P(t): return ("P", t)
def LABEL(t): return ("LABEL", t)          # a bold paragraph that introduces what follows
def UL(items): return ("UL", list(items))  # bullets
def OL(items): return ("OL", list(items))  # numbered, starting at 1
def TABLE(head, rows): return ("TABLE", list(head), [list(r) for r in rows])
def IMG(): return ("IMG",)                 # the workflow picture of the original
def BLANK(): return ("BLANK",)
