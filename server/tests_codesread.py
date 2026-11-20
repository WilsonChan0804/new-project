"""Reading the clauses with no AI: paragraphs, quick facts, diagrams.

    python3 tests_codesread.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import codesread as R  # noqa: E402

B11_2 = """Clause B11.2
The deadend travel distance is limited to:
(a) for Use Classifications 1 and 2:
(i)

24m from any point within a flat/hotel guestroom to the exit door of that
flat/guestroom;

(ii)

15m from the flat/hotel guestroom exit door to the required staircase or
to a point, from which travel in different directions to 2 or more exits is
available;

(c) for all other Use Classifications:
(i)

18m to the protected exit or to a point, from which travel in different
directions to 2 or more exits is available;
"""
DEFS = """Section 3 - Definitions
“Access staircase” means a staircase so designed as to allow firemen access to all storeys; raised
flooring at a height of not more than 600 mm is not counted.
“Deadend travel distance” means the overall length of travel within an exit route before an
alternative is available.
"""


class Read(unittest.TestCase):
    def test_reflow(self):
        t = R.reflow(B11_2)
        self.assertIn("limited to:\n(a) for Use Classifications 1 and 2:\n(i) 24m from any point within a flat/hotel guestroom to the exit door of that flat/guestroom;\n(ii) 15m", t)
        self.assertTrue(t.startswith("Clause B11.2\nThe deadend"))
        # a sentence wrapping onto "Clause B10.6, 24m ..." is not a heading
        self.assertEqual(R.reflow("Where balcony approach is provided complying with\nClause B10.6, 24m to the exit."),
                         "Where balcony approach is provided complying with Clause B10.6, 24m to the exit.")

    def test_quick_facts(self):
        rows = [{"text": DEFS, "ref": "Section 3", "page": 25}, {"text": B11_2, "ref": "Clause B11.2", "page": 46}]
        f = R.quick_facts(rows, ["dead end", "deadend"])
        self.assertEqual([c["ref"] for c in f], ["Clause B11.2"])            # not the 600 mm of a definition
        facts = f[0]["facts"]
        self.assertEqual([x["figure"] for x in facts], ["24m", "15m", "18m"])
        self.assertEqual(facts[0]["when"], "for Use Classifications 1 and 2")
        self.assertEqual(facts[2]["when"], "for all other Use Classifications")
        self.assertEqual(f[0]["lead"], "The deadend travel distance is limited to:")
        self.assertEqual(R.quick_facts(rows, ["staircase pressurisation"]), [])
        self.assertEqual(R.figures("FRR of 120 minutes, 1:12 ramp, 25%, 1,050mm"), ["120 minutes", "1:12", "25%", "1,050mm"])

    def test_captions_and_refs(self):
        pages = ["Diagram A1 shows the framework.\n  Diagram A1 – Framework for Fire Safety", "x\nDiagram B2 : Internal Corridor Access\n",
                 "Diagram B3: Open Plan Layout\nsee Diagram B2 for illustration."]
        self.assertEqual(R.captions(pages), [("A1", 1, "Framework for Fire Safety"), ("B2", 2, "Internal Corridor Access"), ("B3", 3, "Open Plan Layout")])
        self.assertEqual(R.diagram_refs("See Diagrams B2, B3 and B4. Also (see Diagram C2)."), ["B2", "B3", "B4", "C2"])
        self.assertEqual(R.diagram_refs("Diagrams D2 to D5"), ["D2", "D5", "D3", "D4"])


if __name__ == "__main__":
    unittest.main()
