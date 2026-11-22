"""Check each PNAP page against the Buildings Department's current version.

Usage:
    python3 tools/check_versions.py            # report only
    python3 tools/check_versions.py --cache DIR # keep downloaded PDFs in DIR

For every docs/pnap/{adm,app,adv}-N.md page it downloads the current English PDF
from the BD website, reads the revision line ("This revision" / "This version" /
"This update" / "First issue") and compares it with the page's
"Version summarised" field. It also lists PNAPs on BD's index that have no page.

Output lines:
    NEWER   BD has a later revision than the page summarises -> re-check the page
    OLDER   the page claims a later date than the PDF -> check the page's field
    NODATE  the page has no "Version summarised" date
    UNREAD  the PDF revision line could not be read -> check by hand
    NOPAGE  in force on BD's index but not on this site
    REPEALED  BD has repealed a PNAP that still has a page here
"""
import argparse, datetime, html, os, re, subprocess, sys, tempfile, urllib.request

BASE = "https://www.bd.gov.hk/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnap/"
INDEX = "https://www.bd.gov.hk/en/resources/codes-and-references/practice-notes-and-circular-letters/index_pnap.html"
MON = r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*,?\s*(\d{4})"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def month(text):
    m = re.search(MON, text or "")
    return datetime.datetime.strptime(m.group(1) + " " + m.group(2), "%b %Y") if m else None


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(url, headers={"User-Agent": "kb-version-check"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def pdf_revision(pdf):
    t = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    dates = []
    for pat in [r"This\s+(?:revision|version|update|issue)\s*:?\s*\(?([A-Za-z]+\.?\s*,?\s*\d{4})",
                r"First\s+issued?\s*:?\s*\(?([A-Za-z]+\.?\s*,?\s*\d{4})"]:
        dates = [month(x) for x in re.findall(pat, t, re.I)]
        dates = [d for d in dates if d]
        if dates:
            break
    return max(dates) if dates else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "pnap-cache"))
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    pages = sorted(f[:-3] for f in os.listdir(os.path.join(ROOT, "docs/pnap"))
                   if re.fullmatch(r"(adm|app|adv)-\d+\.md", f))
    issues = 0
    for k in pages:
        s, n = k.split("-")
        name = f"{s.upper()}{int(n):03d}.pdf"
        try:
            pdf = fetch(BASE + s.upper() + "/" + name, os.path.join(a.cache, name))
        except Exception as e:
            print("UNREAD ", k, "download failed:", e); issues += 1; continue
        cur = pdf_revision(pdf)
        page = open(os.path.join(ROOT, "docs/pnap", k + ".md"), encoding="utf-8").read()
        m = re.search(r"Version summarised[^|]*\|\s*([^|\n]*)", page)
        ours = month(m.group(1)) if m else None
        if ours is None:
            print("NODATE ", k, "pdf", cur.strftime("%b %Y") if cur else "?"); issues += 1
        elif cur is None:
            print("UNREAD ", k, "page", ours.strftime("%b %Y")); issues += 1
        elif cur > ours:
            print("NEWER  ", k, "page", ours.strftime("%b %Y"), "-> BD", cur.strftime("%b %Y")); issues += 1
        elif cur < ours:
            print("OLDER  ", k, "page", ours.strftime("%b %Y"), "pdf", cur.strftime("%b %Y")); issues += 1
    try:
        idx = os.path.join(a.cache, "index_pnap.html")
        fetch(INDEX, idx)
        t = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", " | ", open(idx, encoding="utf-8", errors="ignore").read())))
        # split the index into one chunk per PNAP row; a row marked "[This practice note ... repealed ...]" is not in force
        rows = re.split(r"\| (?=(?:ADM|APP|ADV)-\d+ \| (?!\.))", t)  # "see | APP-130 | ." inside a note is not a new row
        listed, repealed = set(), {}
        for r in rows:
            m = re.match(r"(ADM|APP|ADV)-(\d+) \|", r)
            if not m: continue
            k = f"{m.group(1).lower()}-{int(m.group(2))}"
            rep = re.search(r"\[\s*This practice note[^\]]*repeal[^\]]*\]", r, re.I)
            if rep: repealed[k] = re.sub(r"\s*\|\s*", " ", rep.group(0)).strip("[] ")
            else: listed.add(k)
        for k in sorted(listed - set(pages), key=lambda k: (k[:3], int(k.split("-")[1]))):
            print("NOPAGE ", k); issues += 1
        for k in sorted(set(repealed) & set(pages)):
            print("REPEALED", k, "has a page but BD says:", repealed[k]); issues += 1
        print(len(repealed), "repealed PNAPs on BD's index (no page needed)")
    except Exception as e:
        print("index not read:", e)
    print(f"{len(pages)} pages checked, {issues} to look at")
    return 0


if __name__ == "__main__":
    sys.exit(main())
