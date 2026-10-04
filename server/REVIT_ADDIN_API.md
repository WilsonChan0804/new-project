# Revit add-in ↔ viewer: selecting elements

This file is for whoever maintains the LWK Revit add-in (the LWK tab: Publish, LWK Issues, "Open in web viewer").

It describes how the add-in can:
- select in Revit the elements a person points at in the viewer (**Show in Revit**);
- send what is selected in Revit to the viewer, so an issue or task can be made about it.

Revit → viewer ("Open in web viewer") already works through `/api/goto` and is unchanged.

Until the add-in does this, the viewer falls back to copying the ElementIds. In Revit, Manage > *Select by ID* takes them as they are (comma separated).

## Sign-in

The same as the add-in's other calls: the header `X-Viewer-Token: <token>`, from `POST /api/login` with the person's email and password. Requests and selections are kept **per person**. The add-in must use the token of the person sitting at Revit, so that their "Show in Revit" clicks reach their own Revit.

## An element

```json
{ "id": "345678", "uid": "60f91daf-3dd7-4283-a86d-24137b73f3da-00054626", "name": "Basic Wall: 200 RC", "category": "Walls" }
```

- `id`: the ElementId, as a string. `uid`: the UniqueId. At least one of them is sent; prefer `uid`, because ElementIds can differ between a central model and its local copies.
- The viewer's 3D models exported by the add-in (`.lwkm`) carry both, for every element.

## Viewer → Revit: "Show in Revit"

### Poll: `GET /api/revit/requests?after=<seq>`

Ask every 2–3 seconds while Revit is open, with `after` = the highest `seq` already handled (0 the first time). Polling also tells the viewer that the add-in is listening; the viewer treats it as listening for 30 seconds after a poll.

Answer:

```json
{
  "seq": 12,
  "requests": [
    {
      "seq": 12,
      "kind": "select",
      "project": "SKW",
      "elements": [{ "id": "345678", "uid": "60f9...4626", "name": "Basic Wall: 200 RC", "category": "Walls" }],
      "issue": "k3j2h1",
      "title": "#12 Clash at grid C/4",
      "viewpoint": null,
      "at": 1791072093.5
    }
  ]
}
```

- `project` is the viewer project (the export folder). If several models are open, use the document that project was published from.
- `issue`, when set, is the issue the elements belong to. The add-in may open LWK Issues on it.
- Requests older than 10 minutes are not returned.

### Do it

1. Find each element: `doc.GetElement(uid)`, else `doc.GetElement(new ElementId(long.Parse(id)))`.
2. Select them: `uidoc.Selection.SetElementIds(ids)`.
3. Show them: `uidoc.ShowElements(ids)`. This opens a view that shows them, if the current one does not.
4. Elements not found (deleted, or in another model): tell the person how many were missing.

Do all of this inside an `IExternalEventHandler` (raised from the polling thread), not from the polling thread itself.

### Done: `POST /api/revit/requests/claim`

Body `{ "seq": 12 }`. The request is then not returned again.

## Revit → viewer: what is selected in Revit

### `POST /api/revit/selection`

Send this when the person asks (a ribbon button "Send selection to viewer"), or on `SelectionChanged`, at most every 2 seconds:

```json
{
  "project": "SKW",
  "document": "YL52-LWK-Z1-BD_B6_LAYOUT-AR-M3-N",
  "elements": [
    { "id": "345678", "uid": "60f9...4626", "name": "Basic Wall: 200 RC", "category": "Walls" }
  ]
}
```

At most 500 elements are kept. The viewer reads it with `GET /api/revit/selection` (kept for an hour) to make an issue or a task about the elements chosen in Revit.

## Quick check from a terminal

```
curl -H "X-Viewer-Token: $T" "https://<server>/api/revit/requests?after=0"
curl -H "X-Viewer-Token: $T" -H "Content-Type: application/json" -d '{"seq":12}' https://<server>/api/revit/requests/claim
curl -H "X-Viewer-Token: $T" "https://<server>/api/revit/status"   # {"addin_seen": true} once the add-in polls
```

## BCF

Separately, the viewer's BCF export now writes each issue's element as:

```xml
<Component IfcGuid="..." OriginatingSystem="Autodesk Revit" AuthoringToolId="345678"/>
```

Revit BCF tools (Autodesk BCF Manager, BCFier, Revizto) select the element from that, so a BCF file is already a working way back into Revit.
