# -*- coding: utf-8 -*-
"""Which button the nightly dialog watcher presses, by the button's label.

The same table is written into the watcher's PowerShell (nightly._WATCH,
ps_rules()) and checked here in Python (answer()), so the tests see the
rules the PCs run.

Revit 2023-2026 show some dialogs as classic Windows dialogs (#32770) and
some as WPF windows (HwndWrapper[...]): at start-up an unsigned add-in, and
while a model opens missing links or third-party updaters. Each rule is
tried in order, only when that button is in the dialog. A button in NEVER
is never pressed, whatever the dialog."""

import fnmatch

# (button patterns, safest first; why; title/text patterns the dialog must
# match, or None for any dialog)
LABEL_RULES = [
    (["Load Once", "Load once*"], "an unsigned add-in: loaded this time only", None),
    (["Ignore and continue opening*"], "missing links: the model opened without them", None),
    (["Continue working with the file*", "*continue working with the file*"],
     "missing third-party updaters: the model opened without them", None),
    (["Do not show again", "Don't show again", "No thanks", "Not now", "Remind me later", "Skip", "Close"],
     "an information window: closed",
     ["*what's new*", "*whats new*", "*customer involvement*", "*analytics*", "*data collection*",
      "*update*available*", "*new version*", "*trial*", "*subscription*expir*"]),
]

# never pressed: they stop the start, the open or the export, or keep a choice
NEVER = ["Cancel", "Abort", "Stop", "Do Not Load", "Always Load", "Exit", "Quit", "Sign in*", "Sign In*"]


def _like(s, pat):
    return fnmatch.fnmatchcase((s or "").lower(), pat.lower())


def never(name):
    return any(_like(name, p) for p in NEVER)


def answer(title, text, buttons, wpf=False):
    """The button to press: (label, why), or None.

    buttons: the dialog's button labels; wpf: a WPF window (only the label
    rules: a floating palette is one too, and is left alone)."""
    hay = (title or "") + " " + (text or "")
    for pats, why, where in LABEL_RULES:
        if where and not any(_like(hay, w) for w in where):
            continue
        for p in pats:
            for b in buttons:
                if _like(b, p) and not never(b):
                    return b, why
    if not wpf:
        ok = [b for b in buttons if not never(b)]
        if len(buttons) == 1 and ok:
            return ok[0], "only one button, nothing to choose"
    return None


def _ps(s):
    return s.replace("'", "''")


def ps_rules():
    """The table as PowerShell: sets $ans (the label to press) and $why from
    $bs (the buttons, [name, how, handle]), $title and $txt."""
    out = ["$hay=$title+' '+$txt"]
    for pats, why, where in LABEL_RULES:
        cond = "-not $ans"
        if where:
            cond += " -and (" + " -or ".join("$hay -like '%s'" % _ps(w) for w in where) + ")"
        out.append("if(%s){ foreach($p in @(%s)){ if(-not $ans){ foreach($b in $bs){ if(-not $ans -and $b[0] -like $p -and -not (Never $b[0])){ $ans=@($b[0]); $why='%s' } } } } }"
                   % (cond, ",".join("'%s'" % _ps(p) for p in pats), _ps(why)))
    return "\n".join(out)


def ps_never():
    return "function Never($n){ foreach($p in @(%s)){ if($n -like $p){ return $true } }; return $false }" % ",".join(
        "'%s'" % _ps(p) for p in NEVER)
