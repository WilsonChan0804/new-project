/* BCF 2.1 export.
 *
 * Produces a .bcfzip that Revit, Navisworks and Solibri can open: one
 * folder per topic containing markup.bcf, viewpoint.bcfv and snapshot.png.
 *
 * Two conversions matter and both are easy to get silently wrong.
 *
 * Units. BCF cameras are in METRES. The viewer stores issue positions in
 * millimetres to match the Revit exporter, so everything is divided by
 * 1000 on the way out.
 *
 * Handedness. The fragments scene is Y-up; IFC, and therefore BCF, is
 * Z-up. A camera written without converting lands the reviewer on their
 * side, under the building, which looks like a broken export rather than a
 * rotated axis. The mapping used is ifc = (x, -z, y), the inverse of the
 * usual Z-up to Y-up conversion.
 */

import { zip } from "./zip.js";

export const SCHEMA = "2.1";

function xmlEscape(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* Scene millimetres (Y-up) to BCF metres (Z-up). */
export function toBcf(mm) {
  if (!mm) return null;
  return {
    x: mm[0] / 1000,
    y: -mm[2] / 1000,
    z: mm[1] / 1000,
  };
}

/* Coordinates already converted to Revit's internal frame are Z-up and in
   the right place, so they only need scaling. Using these instead of the
   scene values is what moves a topic from "somewhere near the building" to
   the element itself. */
export function internalToBcf(mm) {
  if (!mm) return null;
  return { x: mm[0] / 1000, y: mm[1] / 1000, z: mm[2] / 1000 };
}

function vec(tag, v) {
  return `    <${tag}>\n`
    + `      <X>${v.x}</X>\n      <Y>${v.y}</Y>\n      <Z>${v.z}</Z>\n`
    + `    </${tag}>`;
}

function isoDate(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/* BCF status values are free text in 2.1, but these are the ones the common
   tools recognise, so viewer statuses are mapped onto them. */
const STATUS = {
  "Open": "Open",
  "In progress": "In Progress",
  "Resolved": "Resolved",
  "Closed": "Closed",
};

/* The two pages store an issue's position differently: a 3D issue carries
   model_mm directly, a sheet markup keeps it inside `anchor` along with the
   view it fell in. Both shapes are read here so neither page needs to know
   about BCF. */
function placement(item) {
  if (item.placement === "3d") {
    return {
      /* Prefer the original model coordinates. The plain model_mm is in
         scene space, which the viewer shifts to line models up, so using it
         puts the topic a translation away from the real element. */
      model_mm: item.model_internal_mm || item.model_original_mm
        || item.model_mm || null,
      normal: null,
      view_name: item.model_name || null,
      ifc_guid: item.ifc_guid || null,
    };
  }
  const a = item.anchor || {};
  return {
    model_mm: a.model_mm || null,
    normal: a.normal || null,
    view_name: a.view_name || null,
    ifc_guid: null,
  };
}

function paperPoint(item) {
  const p = item.points_mm && item.points_mm[0];
  return p || item.paper_mm || null;
}

function markupXml(item, viewpointGuid, hasSnapshot) {
  const iss = item.issue || {};
  const topicGuid = iss.guid || item.id || uuid();
  const created = isoDate(iss.created_at || item.created_at);
  const author = iss.author || "LWK Viewer";

  const pl = placement(item);
  const where = [];
  if (item.placement === "3d") {
    if (pl.view_name) where.push(`Model: ${pl.view_name}`);
    if (pl.ifc_guid) where.push(`IFC GUID: ${pl.ifc_guid}`);
  } else {
    if (item.sheet) where.push(`Sheet: ${item.sheet}`);
    const pp = paperPoint(item);
    if (pp) {
      where.push(`Paper position: ${pp[0].toFixed(0)}, ${pp[1].toFixed(0)} `
        + "mm from the titleblock corner");
    }
    if (pl.view_name) where.push(`View: ${pl.view_name}`);
    if (item.type) where.push(`Markup: ${item.type}`);
    if (!pl.model_mm) {
      where.push("No model position: this markup is outside any "
        + "model-mapped viewport, so no camera could be derived.");
    }
  }
  if (pl.model_mm) {
    where.push(`Model position: ${pl.model_mm.map((n) => n.toFixed(0)).join(", ")} mm`);
  }

  const description = [iss.description, where.join("\n")]
    .filter(Boolean).join("\n\n");

  /* Element order follows the 2.1 schema. Tools that validate will reject
     a Topic whose children are shuffled, even when every value is right. */
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n';
  xml += `  <Topic Guid="${xmlEscape(topicGuid)}" TopicType="Issue" `
    + `TopicStatus="${xmlEscape(STATUS[iss.status] || "Open")}">\n`;
  xml += `    <Title>${xmlEscape(iss.title || "Issue")}</Title>\n`;
  if (iss.priority) xml += `    <Priority>${xmlEscape(iss.priority)}</Priority>\n`;
  xml += `    <CreationDate>${created}</CreationDate>\n`;
  xml += `    <CreationAuthor>${xmlEscape(author)}</CreationAuthor>\n`;
  if (iss.due_date) {
    xml += `    <DueDate>${isoDate(iss.due_date)}</DueDate>\n`;
  }
  if (iss.assigned_to) {
    xml += `    <AssignedTo>${xmlEscape(iss.assigned_to)}</AssignedTo>\n`;
  }
  if (description) {
    xml += `    <Description>${xmlEscape(description)}</Description>\n`;
  }
  xml += "  </Topic>\n";

  if (iss.description) {
    xml += `  <Comment Guid="${uuid()}">\n`;
    xml += `    <Date>${created}</Date>\n`;
    xml += `    <Author>${xmlEscape(author)}</Author>\n`;
    xml += `    <Comment>${xmlEscape(iss.description)}</Comment>\n`;
    if (viewpointGuid) xml += `    <Viewpoint Guid="${viewpointGuid}"/>\n`;
    xml += "  </Comment>\n";
  }

  if (viewpointGuid) {
    xml += `  <Viewpoints Guid="${viewpointGuid}">\n`;
    xml += "    <Viewpoint>viewpoint.bcfv</Viewpoint>\n";
    if (hasSnapshot) xml += "    <Snapshot>snapshot.png</Snapshot>\n";
    xml += "  </Viewpoints>\n";
  }

  xml += "</Markup>\n";
  return { xml, topicGuid };
}

/* A sheet markup has no camera, but if it landed inside a mapped viewport
   it has a model position and the view's own direction. That is enough to
   synthesise a camera looking at the spot the way the drawing looks at it,
   which turns "no viewpoint to zoom to" into a usable one. */
function derivedViewpoint(item) {
  const pl = placement(item);
  if (!pl.model_mm) return null;

  const n = pl.normal && pl.normal.length === 3 ? pl.normal.slice() : [0, 0, -1];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const dir = [n[0] / len, n[1] / len, n[2] / len];

  // Stand back far enough to see the surroundings, along the view direction.
  const back = 8000;                       // 8 m, in millimetres
  return {
    position_mm: [
      pl.model_mm[0] - dir[0] * back,
      pl.model_mm[1] - dir[1] * back,
      pl.model_mm[2] - dir[2] * back,
    ],
    target_mm: pl.model_mm.slice(),
    fov: 60,
    derived: true,
  };
}

/* Where the cross goes, in BCF metres: a 3D issue's own point (in Revit's
   internal frame); a sheet markup's model point, converted the way its
   derived camera is, so the cross sits where that camera looks. */
function markPoint(item, vp) {
  if (item.placement === "3d") {
    if (item.model_internal_mm) return internalToBcf(item.model_internal_mm);
    if (item.model_original_mm || item.model_mm) return toBcf(item.model_original_mm || item.model_mm);
    return null;
  }
  const pl = placement(item);
  if (!pl.model_mm) return null;
  if (vp && vp.target_internal_mm && !vp.derived) return internalToBcf(pl.model_mm);
  return toBcf(pl.model_mm);
}

function viewpointXml(item, guid) {
  const vp = item.viewpoint || derivedViewpoint(item);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<VisualizationInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `
    + `Guid="${guid}">\n`;

  const pl = placement(item);
  if (pl.ifc_guid) {
    xml += "  <Components>\n    <Selection>\n";
    xml += `      <Component IfcGuid="${xmlEscape(pl.ifc_guid)}"/>\n`;
    xml += "    </Selection>\n";
    xml += '    <Visibility DefaultVisibility="true"/>\n';
    xml += "  </Components>\n";
  }

  const internal = vp && vp.position_internal_mm && vp.target_internal_mm;
  const eyeSrc = internal ? vp.position_internal_mm
    : (vp && (vp.position_model_mm || vp.position_mm));
  const tgtSrc = internal ? vp.target_internal_mm
    : (vp && (vp.target_model_mm || vp.target_mm));
  if (eyeSrc && tgtSrc) {
    const conv = internal ? internalToBcf : toBcf;
    const eye = conv(eyeSrc);
    const tgt = conv(tgtSrc);
    const dir = {
      x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z,
    };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= len; dir.y /= len; dir.z /= len;

    /* Up is derived rather than copied: the stored up vector is in the
       Y-up scene, and a camera whose up is not perpendicular to its
       direction is rejected by some readers. */
    const worldUp = { x: 0, y: 0, z: 1 };
    const dot = dir.x * worldUp.x + dir.y * worldUp.y + dir.z * worldUp.z;
    let up = {
      x: worldUp.x - dir.x * dot,
      y: worldUp.y - dir.y * dot,
      z: worldUp.z - dir.z * dot,
    };
    const ulen = Math.hypot(up.x, up.y, up.z);
    up = ulen > 1e-6 ? { x: up.x / ulen, y: up.y / ulen, z: up.z / ulen }
                     : { x: 0, y: 1, z: 0 };   // looking straight up or down

    xml += "  <PerspectiveCamera>\n";
    xml += vec("CameraViewPoint", eye) + "\n";
    xml += vec("CameraDirection", dir) + "\n";
    xml += vec("CameraUpVector", up) + "\n";
    xml += `    <FieldOfView>${vp.fov || 60}</FieldOfView>\n`;
    xml += "  </PerspectiveCamera>\n";
  }

  /* A cross at the issue itself, one metre each way along the three axes:
     Revit's BCF add-ins, Navisworks and Solibri draw a viewpoint's Lines in
     the model, so the spot is marked even when the camera is far off or
     the topic has no element attached. */
  const mark = markPoint(item, vp);
  if (mark) {
    const h = 0.5;
    const seg = (a, b) => "    <Line>\n"
      + vec("StartPoint", a).replace(/^ {4}/gm, "      ") + "\n"
      + vec("EndPoint", b).replace(/^ {4}/gm, "      ") + "\n    </Line>\n";
    xml += "  <Lines>\n";
    xml += seg({ x: mark.x - h, y: mark.y, z: mark.z }, { x: mark.x + h, y: mark.y, z: mark.z });
    xml += seg({ x: mark.x, y: mark.y - h, z: mark.z }, { x: mark.x, y: mark.y + h, z: mark.z });
    xml += seg({ x: mark.x, y: mark.y, z: mark.z - h }, { x: mark.x, y: mark.y, z: mark.z + h });
    xml += "  </Lines>\n";
  }

  /* The section box (or plane) the issue was raised in, as BCF clipping
     planes: Revit's BCF add-ins turn six of them into a section box, so the
     issue opens at the same cut. Only for a camera in Revit's own frame -
     the planes are stored in it. */
  if (internal && Array.isArray(vp.clipping_internal) && vp.clipping_internal.length) {
    xml += "  <ClippingPlanes>\n";
    for (const c of vp.clipping_internal) {
      const loc = internalToBcf(c.location_mm);
      const dir = { x: c.direction[0], y: c.direction[1], z: c.direction[2] };
      xml += "    <ClippingPlane>\n";
      xml += vec("Location", loc).replace(/^ {4}/gm, "      ") + "\n";
      xml += vec("Direction", dir).replace(/^ {4}/gm, "      ") + "\n";
      xml += "    </ClippingPlane>\n";
    }
    xml += "  </ClippingPlanes>\n";
  }

  xml += "</VisualizationInfo>\n";
  return xml;
}

/* A data URL to raw bytes. BCF snapshots are declared as PNG, so anything
   stored as JPEG is re-encoded before it goes in. */
async function snapshotBytes(dataUrl) {
  if (!dataUrl) return null;
  let url = dataUrl;

  /* Snapshots are stored on the server and referenced by path, so most of
     these arrive as "/snapshots/xxx.jpg" rather than as data. Fetching it
     back is what keeps BCF export working from any machine, not just the
     one that raised the issue. */
  if (!/^data:/.test(url)) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      url = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve(null);
        fr.readAsDataURL(blob);
      });
      if (!url) return null;
    } catch (e) {
      return null;
    }
  }

  if (!/^data:image\/png/i.test(url)) {
    url = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
    if (!url) return null;
  }

  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const VERSION_XML = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<Version xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
  + 'VersionId="2.1">\n  <DetailedVersion>2.1</DetailedVersion>\n</Version>\n';

/* Build a .bcfzip from viewer items. Only items carrying an issue are
   exported: plain markup is a comment on a drawing, not a tracked topic. */
export async function buildBcf(items, project) {
  const topics = items.filter((it) => it && it.issue && it.issue.title);
  if (!topics.length) throw new Error("No issues to export.");

  const files = [{ name: "bcf.version", data: VERSION_XML }];
  let withCamera = 0, withSnapshot = 0, derivedCount = 0;
  /* Verified against Revit with a top-down calibration view: internal
     coordinates land on the building, shared ones land on nothing. A topic
     falling back to another basis is a topic raised before the viewer knew
     how to compute it, and it will be in the wrong place - so the count is
     reported rather than left silent. */
  let onInternal = 0, onFallback = 0;

  for (const item of topics) {
    const vpGuid = uuid();
    const derived = item.viewpoint ? null : derivedViewpoint(item);
    const cam = item.viewpoint || derived;
    const hasCamera = !!(cam
      && (cam.position_internal_mm || cam.position_model_mm || cam.position_mm)
      && (cam.target_internal_mm || cam.target_model_mm || cam.target_mm));

    const snap = await snapshotBytes(item.snapshot);
    if (snap) withSnapshot++;
    if (hasCamera) withCamera++;
    if (derived && hasCamera) derivedCount++;
    if (hasCamera) {
      if (cam.position_internal_mm) onInternal++;
      else onFallback++;
    }

    // A viewpoint folder is only written when there is something in it.
    const wantViewpoint = hasCamera || !!placement(item).ifc_guid || !!markPoint(item, cam);
    const { xml, topicGuid } = markupXml(
      item, wantViewpoint ? vpGuid : null, !!snap);

    files.push({ name: `${topicGuid}/markup.bcf`, data: xml });
    if (wantViewpoint) {
      files.push({
        name: `${topicGuid}/viewpoint.bcfv`,
        data: viewpointXml(item, vpGuid),
      });
    }
    if (snap) files.push({ name: `${topicGuid}/snapshot.png`, data: snap });
  }

  return {
    blob: zip(files),
    count: topics.length,
    withCamera,
    withDerivedCamera: derivedCount,
    onInternal,
    onFallback,
    withSnapshot,
    skipped: items.length - topics.length,
    project: project || "",
  };
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}


/* ------------------------------------------------------------ axis test */

/* Height maps cleanly (scene Y is IFC Z, confirmed by issues landing on the
   right level), but the horizontal pair has eight plausible arrangements
   and they are indistinguishable from inside the viewer. Rather than change
   one and re-test, all eight are written as separate topics aimed at the
   same point. Whichever lands on the spot names the correct mapping. */
export const AXIS_MAPS = [
  { id: "A", label: "x, -z, y", f: (p) => [p[0], -p[2], p[1]] },
  { id: "B", label: "x, z, y", f: (p) => [p[0], p[2], p[1]] },
  { id: "C", label: "-x, z, y", f: (p) => [-p[0], p[2], p[1]] },
  { id: "D", label: "-x, -z, y", f: (p) => [-p[0], -p[2], p[1]] },
  { id: "E", label: "z, x, y", f: (p) => [p[2], p[0], p[1]] },
  { id: "F", label: "-z, x, y", f: (p) => [-p[2], p[0], p[1]] },
  { id: "G", label: "z, -x, y", f: (p) => [p[2], -p[0], p[1]] },
  { id: "H", label: "-z, -x, y", f: (p) => [-p[2], -p[0], p[1]] },
];

function axisViewpointXml(guid, eyeMM, tgtMM, fov, map) {
  /* map.f rearranges the axes; the divide by 1000 turns millimetres into
     the metres BCF expects. For the already-Z-up basis map.f is identity,
     so the same code serves both. */
  const m = (p) => {
    const q = map.f(p);
    return { x: q[0] / 1000, y: q[1] / 1000, z: q[2] / 1000 };
  };
  const eye = m(eyeMM);
  const tgt = m(tgtMM);

  const dir = { x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len; dir.y /= len; dir.z /= len;

  const dot = dir.z;                       // world up is (0,0,1) in IFC
  let up = { x: -dir.x * dot, y: -dir.y * dot, z: 1 - dir.z * dot };
  const ulen = Math.hypot(up.x, up.y, up.z);
  up = ulen > 1e-6 ? { x: up.x / ulen, y: up.y / ulen, z: up.z / ulen }
                   : { x: 0, y: 1, z: 0 };

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<VisualizationInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `
    + `Guid="${guid}">\n`;
  xml += "  <PerspectiveCamera>\n";
  xml += vec("CameraViewPoint", eye) + "\n";
  xml += vec("CameraDirection", dir) + "\n";
  xml += vec("CameraUpVector", up) + "\n";
  xml += `    <FieldOfView>${fov || 60}</FieldOfView>\n`;
  xml += "  </PerspectiveCamera>\n";
  xml += "</VisualizationInfo>\n";
  return xml;
}

/* Two unknowns, not one. The axis arrangement is one; the other is which
   origin BCF coordinates are measured from. This model was exported on
   shared coordinates, so its own numbers are Hong Kong grid values around
   835 km, while the scene has been shifted to the origin for rendering.
   Whether a BCF reader wants the grid value or the shifted one is not
   something the viewer can determine, so both are written.

   cams: { scene: {eye,target}, original: {eye,target} } in millimetres. */
export async function buildAxisTest(cams, fov, snapshotUrl) {
  const bases = [];
  if (cams.internal && cams.internal.eye) {
    bases.push(["internal", cams.internal, internalToBcf]);
  }
  /* Shared coordinates, verified against a Revit Spot Coordinate to within
     a metre. Already Z-up, so no axis permutation applies. */
  if (cams.shared && cams.shared.eye) {
    bases.push(["shared", cams.shared, internalToBcf]);
  }
  if (cams.scene && cams.scene.eye) bases.push(["scene", cams.scene, null]);
  if (cams.original && cams.original.eye) {
    bases.push(["grid", cams.original, null]);
  }
  if (!bases.length) throw new Error("No camera to calibrate with.");

  const files = [{ name: "bcf.version", data: VERSION_XML }];
  const snap = await snapshotBytes(snapshotUrl);
  const now = new Date().toISOString();
  let n = 0;

  for (const [baseName, cam, direct] of bases) {
    /* Internal coordinates are already Z-up, so the axis permutations do
       not apply to them: there is exactly one sensible mapping. */
    const maps = direct ? [{ id: "Z", label: "already Z-up", f: (p) => p }]
                        : AXIS_MAPS;
    for (const map of maps) {
      const topicGuid = uuid();
      const vpGuid = uuid();
      n++;

      const title = `TEST ${map.id}-${baseName} (${map.label})`;
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n';
      xml += `  <Topic Guid="${topicGuid}" TopicType="Issue" TopicStatus="Open">\n`;
      xml += `    <Title>${xmlEscape(title)}</Title>\n`;
      xml += `    <CreationDate>${now}</CreationDate>\n`;
      xml += "    <CreationAuthor>LWK Viewer</CreationAuthor>\n";
      xml += "    <Description>"
        + "Every topic in this file aims at the same place, using a "
        + "different combination of axis mapping and origin. Click through "
        + "them: the one that lands where you intended names the right "
        + "combination.\n\n"
        + `Axis mapping: ${xmlEscape(map.label)}\n`
        + `Origin: ${baseName === "internal"
            ? "Revit internal coordinates, via the project location transform"
            : baseName === "shared"
              ? "Revit shared coordinates, matching a Spot Coordinate reading"
              : baseName === "grid"
                ? "the model's own coordinates, axis order untested"
                : "the viewer's shifted scene origin"}\n`
        + `Eye (mm, before mapping): ${cam.eye.map((v) => v.toFixed(0)).join(", ")}`
        + "</Description>\n";
      xml += "  </Topic>\n";
      xml += `  <Viewpoints Guid="${vpGuid}">\n`;
      xml += "    <Viewpoint>viewpoint.bcfv</Viewpoint>\n";
      if (snap) xml += "    <Snapshot>snapshot.png</Snapshot>\n";
      xml += "  </Viewpoints>\n";
      xml += "</Markup>\n";

      files.push({ name: `${topicGuid}/markup.bcf`, data: xml });
      files.push({
        name: `${topicGuid}/viewpoint.bcfv`,
        data: axisViewpointXml(vpGuid, cam.eye, cam.target, fov, map),
      });
      if (snap) files.push({ name: `${topicGuid}/snapshot.png`, data: snap });
    }
  }

  return { blob: zip(files), count: n };
}


/* -------------------------------------------------------- top view test */

/* Perspective calibration views are unreadable in a Revit coordination
   view: the model is drawn as wireframe, so a camera in the right place
   and one fifty metres away produce the same tangle of green lines. A
   camera placed directly above the building looking straight down does
   not have that problem. Either the plan of the building fills the view,
   or the coordinate system is wrong and the screen is blank. */
export async function buildTopTest(centres, extentM, snapshotUrl) {
  const bases = [];
  if (centres.internal) bases.push(["internal", centres.internal]);
  if (centres.shared) bases.push(["shared", centres.shared]);
  if (!bases.length) throw new Error("No model centre to calibrate with.");

  const files = [{ name: "bcf.version", data: VERSION_XML }];
  const snap = await snapshotBytes(snapshotUrl);
  const now = new Date().toISOString();
  const up = Math.max(60, (extentM || 100) * 1.2);

  for (const [name, centreMM] of bases) {
    const topicGuid = uuid();
    const vpGuid = uuid();

    const tgt = { x: centreMM[0] / 1000, y: centreMM[1] / 1000,
                  z: centreMM[2] / 1000 };
    const eye = { x: tgt.x, y: tgt.y, z: tgt.z + up };

    let vx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    vx += `<VisualizationInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `
      + `Guid="${vpGuid}">\n`;
    vx += "  <PerspectiveCamera>\n";
    vx += vec("CameraViewPoint", eye) + "\n";
    vx += vec("CameraDirection", { x: 0, y: 0, z: -1 }) + "\n";
    // Looking straight down, so "up" on screen is north.
    vx += vec("CameraUpVector", { x: 0, y: 1, z: 0 }) + "\n";
    vx += "    <FieldOfView>60</FieldOfView>\n";
    vx += "  </PerspectiveCamera>\n";
    vx += "</VisualizationInfo>\n";

    let mx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    mx += '<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n';
    mx += `  <Topic Guid="${topicGuid}" TopicType="Issue" TopicStatus="Open">\n`;
    mx += `    <Title>TOP VIEW - ${name} coordinates</Title>\n`;
    mx += `    <CreationDate>${now}</CreationDate>\n`;
    mx += "    <CreationAuthor>LWK Viewer</CreationAuthor>\n";
    mx += "    <Description>"
      + "Camera placed directly above the middle of the building, looking "
      + "straight down. If this coordinate system is the right one you will "
      + "see the building in plan. If it is wrong the view will be empty. "
      + "There is no third outcome, which is the point of this test.\n\n"
      + `Coordinates: ${name}\n`
      + `Camera at: ${eye.x.toFixed(1)}, ${eye.y.toFixed(1)}, `
      + `${eye.z.toFixed(1)} m\n`
      + `Looking down at: ${tgt.x.toFixed(1)}, ${tgt.y.toFixed(1)}, `
      + `${tgt.z.toFixed(1)} m</Description>\n`;
    mx += "  </Topic>\n";
    mx += `  <Viewpoints Guid="${vpGuid}">\n`;
    mx += "    <Viewpoint>viewpoint.bcfv</Viewpoint>\n";
    if (snap) mx += "    <Snapshot>snapshot.png</Snapshot>\n";
    mx += "  </Viewpoints>\n";
    mx += "</Markup>\n";

    files.push({ name: `${topicGuid}/markup.bcf`, data: mx });
    files.push({ name: `${topicGuid}/viewpoint.bcfv`, data: vx });
    if (snap) files.push({ name: `${topicGuid}/snapshot.png`, data: snap });
  }

  return { blob: zip(files), count: bases.length };
}


/* ------------------------------------------------------------ import

   A .bcfzip from Revit, Navisworks, Solibri, ACC ... read into topics:
   title, status, priority, who and when, the description, the comments,
   the first viewpoint's camera, its selected elements (IFC GUIDs), its
   Lines (a marked point) and its snapshot. The caller turns them into 3D
   issues. BCF 2.0, 2.1 and 3.0 share what is read here. */

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("this browser cannot unpack zip files");
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

/* Every file in a zip, by name (stored and deflated entries). */
export async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const ln = dv.getUint16(loc + 26, true), lx = dv.getUint16(loc + 28, true);
    const data = u8.subarray(loc + 30 + ln + lx, loc + 30 + ln + lx + csize);
    out.set(name, method === 0 ? data.slice() : method === 8 ? await inflateRaw(data) : null);
  }
  return out;
}

const txt = (el, tag) => {
  const n = el && el.getElementsByTagName(tag)[0];
  return n ? n.textContent.trim() : "";
};
const num3 = (el) => el ? [txt(el, "X"), txt(el, "Y"), txt(el, "Z")].map(Number) : null;
const STATUS_IN = { open: "Open", active: "Open", new: "Open", assigned: "Open", "in progress": "In progress",
  inprogress: "In progress", resolved: "Resolved", done: "Resolved", fixed: "Resolved", closed: "Closed" };

export async function readBcf(buf) {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const xml = (name) => {
    const b = files.get(name);
    return b ? new DOMParser().parseFromString(dec.decode(b), "application/xml") : null;
  };
  const folders = new Set();
  for (const name of files.keys()) {
    const m = name.match(/^(.*?)(?:^|\/)markup\.bcf$/i);
    if (m) folders.add(name.slice(0, name.length - "markup.bcf".length));
  }
  const topics = [];
  for (const dir of folders) {
    const mk = xml(dir + "markup.bcf");
    if (!mk) continue;
    const t = mk.getElementsByTagName("Topic")[0];
    if (!t) continue;
    const status = (t.getAttribute("TopicStatus") || txt(t, "TopicStatus") || "Open").toLowerCase();
    const comments = [...mk.getElementsByTagName("Comment")]
      .filter((c) => c.parentNode && (c.parentNode.nodeName === "Markup" || c.parentNode.nodeName === "Comments"))
      .map((c) => ({ author: txt(c, "Author") || "?", at: txt(c, "Date") || null,
                     text: (c.getElementsByTagName("Comment")[0] || {}).textContent || "" }))
      .filter((c) => c.text.trim());
    // the first viewpoint (BCF 2: <Viewpoints>; 3: <Viewpoints><ViewPoint>)
    const vpEl = mk.getElementsByTagName("Viewpoints")[0];
    let vpFile = null, snapFile = null;
    if (vpEl) {
      vpFile = txt(vpEl, "Viewpoint") || null;
      snapFile = txt(vpEl, "Snapshot") || null;
    }
    if (!vpFile && files.has(dir + "viewpoint.bcfv")) vpFile = "viewpoint.bcfv";
    if (!snapFile && files.has(dir + "snapshot.png")) snapFile = "snapshot.png";
    let camera = null, guids = [], mark = null;
    const vx = vpFile ? xml(dir + vpFile) : null;
    if (vx) {
      const pc = vx.getElementsByTagName("PerspectiveCamera")[0] || vx.getElementsByTagName("OrthogonalCamera")[0];
      if (pc) {
        const eye = num3(pc.getElementsByTagName("CameraViewPoint")[0]);
        const dir3 = num3(pc.getElementsByTagName("CameraDirection")[0]);
        if (eye && dir3 && eye.every(isFinite) && dir3.every(isFinite)) {
          camera = { eye, dir: dir3, fov: Number(txt(pc, "FieldOfView")) || 60,
                     ortho: pc.nodeName === "OrthogonalCamera" };
        }
      }
      const sel = vx.getElementsByTagName("Selection")[0];
      if (sel) guids = [...sel.getElementsByTagName("Component")].map((c) => c.getAttribute("IfcGuid")).filter(Boolean);
      const lines = [...vx.getElementsByTagName("Line")];
      if (lines.length) {
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const l of lines) for (const tag of ["StartPoint", "EndPoint"]) {
          const v = num3(l.getElementsByTagName(tag)[0]);
          if (v && v.every(isFinite)) { sx += v[0]; sy += v[1]; sz += v[2]; n++; }
        }
        if (n) mark = [sx / n, sy / n, sz / n];
      }
    }
    let snapshot = null;
    const sb = snapFile ? files.get(dir + snapFile) : null;
    if (sb && sb.length) {
      const type = /\.jpe?g$/i.test(snapFile) ? "image/jpeg" : "image/png";
      snapshot = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(new Blob([sb], { type }));
      });
    }
    topics.push({
      guid: t.getAttribute("Guid") || null,
      title: txt(t, "Title") || "Imported issue",
      type: t.getAttribute("TopicType") || txt(t, "TopicType") || "",
      status: STATUS_IN[status] || "Open",
      priority: txt(t, "Priority") || "",
      author: txt(t, "CreationAuthor") || "",
      created: txt(t, "CreationDate") || null,
      assigned: txt(t, "AssignedTo") || "",
      due: txt(t, "DueDate") || null,
      description: txt(t, "Description") || "",
      labels: [...t.getElementsByTagName("Labels")].map((l) => l.textContent.trim()).filter(Boolean),
      comments, camera, guids, mark, snapshot,
    });
  }
  return topics;
}
