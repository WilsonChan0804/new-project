# -*- coding: utf-8 -*-
"""The SBD masses as an IFC file (IFC4, metres), so they can be a model in
the project's 3D like a consultant model (refs.py converts it): each mass an
IfcBuildingElementProxy with a faceted B-rep of its triangles, in the
coordinates they were exported in (the Revit model's internal origin)."""

import time
import uuid

_CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def guid():
    """An IFC GlobalId (22 characters, base 64 of a UUID)."""
    n = uuid.uuid4().int
    out = []
    for i in range(22):
        out.append(_CH[n % 64])
        n //= 64
    return "".join(reversed(out))


def _s(t):
    """IFC text: ASCII, quotes doubled, others as \\X2\\ escapes."""
    out = []
    for c in str(t or ""):
        if c == "'":
            out.append("''")
        elif c == "\\":
            out.append("\\\\")
        elif 32 <= ord(c) < 127:
            out.append(c)
        else:
            out.append("\\X2\\%04X\\X0\\" % ord(c))
    return "".join(out)


def _f(v):
    s = "%.4f" % v
    s = s.rstrip("0")
    return s + "0" if s.endswith(".") else s


def masses_ifc(masses, name="SBD masses", author=""):
    lines = []
    n = [0]

    def add(txt):
        n[0] += 1
        lines.append("#%d=%s;" % (n[0], txt))
        return "#%d" % n[0]

    person = add("IFCPERSON($,'%s',$,$,$,$,$,$)" % _s(author or "LWK"))
    org = add("IFCORGANIZATION($,'LWK + PARTNERS',$,$,$)")
    po = add("IFCPERSONANDORGANIZATION(%s,%s,$)" % (person, org))
    app = add("IFCAPPLICATION(%s,'1','LWK Viewer SBD','LWKSBD')" % org)
    oh = add("IFCOWNERHISTORY(%s,%s,$,.ADDED.,$,$,$,%d)" % (po, app, int(time.time())))
    origin = add("IFCCARTESIANPOINT((0.,0.,0.))")
    zdir = add("IFCDIRECTION((0.,0.,1.))")
    xdir = add("IFCDIRECTION((1.,0.,0.))")
    a3 = add("IFCAXIS2PLACEMENT3D(%s,%s,%s)" % (origin, zdir, xdir))
    ctx = add("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,%s,$)" % a3)
    body = add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,%s,$,.MODEL_VIEW.,$)" % ctx)
    lu = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")
    au = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)")
    vu = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)")
    units = add("IFCUNITASSIGNMENT((%s,%s,%s))" % (lu, au, vu))
    proj = add("IFCPROJECT('%s',%s,'%s',$,$,$,$,(%s),%s)" % (guid(), oh, _s(name), ctx, units))
    pl_site = add("IFCLOCALPLACEMENT($,%s)" % a3)
    site = add("IFCSITE('%s',%s,'Site',$,$,%s,$,$,.ELEMENT.,$,$,$,$,$)" % (guid(), oh, pl_site))
    pl_bld = add("IFCLOCALPLACEMENT(%s,%s)" % (pl_site, a3))
    bld = add("IFCBUILDING('%s',%s,'%s',$,$,%s,$,$,.ELEMENT.,$,$,$)" % (guid(), oh, _s(name), pl_bld))
    add("IFCRELAGGREGATES('%s',%s,$,$,%s,(%s))" % (guid(), oh, proj, site))
    add("IFCRELAGGREGATES('%s',%s,$,$,%s,(%s))" % (guid(), oh, site, bld))
    elems = []
    for m in masses:
        verts, tris = m.get("verts") or [], m.get("tris") or []
        if not tris:
            continue
        pts = [add("IFCCARTESIANPOINT((%s,%s,%s))" % (_f(v[0]), _f(v[1]), _f(v[2]))) for v in verts]
        faces = []
        for a, b, c in tris:
            loop = add("IFCPOLYLOOP((%s,%s,%s))" % (pts[a], pts[b], pts[c]))
            bound = add("IFCFACEOUTERBOUND(%s,.T.)" % loop)
            faces.append(add("IFCFACE((%s))" % bound))
        shell = add("IFCCLOSEDSHELL((%s))" % ",".join(faces))
        brep = add("IFCFACETEDBREP(%s)" % shell)
        rep = add("IFCSHAPEREPRESENTATION(%s,'Body','Brep',(%s))" % (body, brep))
        shape = add("IFCPRODUCTDEFINITIONSHAPE($,$,(%s))" % rep)
        pl = add("IFCLOCALPLACEMENT(%s,%s)" % (pl_bld, a3))
        elems.append(add("IFCBUILDINGELEMENTPROXY('%s',%s,'%s','SBD mass',$,%s,%s,'%s',.ELEMENT.)" % (
            guid(), oh, _s(m.get("name") or "Mass"), pl, shape, _s(m.get("id") or ""))))
    if elems:
        add("IFCRELCONTAINEDINSPATIALSTRUCTURE('%s',%s,$,$,(%s),%s)" % (guid(), oh, ",".join(elems), bld))
    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');\n"
            "FILE_NAME('sbd-masses.ifc','%s',('%s'),('LWK + PARTNERS'),'LWK Viewer','LWK Viewer SBD','');\n"
            "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n") % (time.strftime("%Y-%m-%dT%H:%M:%S"), _s(author))
    return head + "\n".join(lines) + "\nENDSEC;\nEND-ISO-10303-21;\n"
