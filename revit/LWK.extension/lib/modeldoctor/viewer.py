# -*- coding: utf-8 -*-
"""Model Doctor and the LWK Viewer: the project's "Not an error" list and the
fix queue, read and written on the viewer server.

The sign-in is LWK Issues' own (one sign-in serves Publish, LWK Issues and
this): the server and token it saved, and the viewer project it chose for
this Revit document. Without them the tool works as before, on its own,
and says so once.
"""
from modeldoctor import shared


class ViewerLink(object):

    def __init__(self, doc_title):
        self.ok = False
        self.why = ""
        self.items = []
        self.client = None
        self.project = ""
        self.me = ""
        try:
            from lwk_viewer import issues as L
        except Exception as ex:
            self.why = "the LWK viewer library is not installed (%s)" % ex
            return
        st = L.load_settings()
        base, token = st.get("server") or "", st.get("token") or ""
        self.project = (st.get("doc_projects") or {}).get(doc_title or "") or ""
        if not (base and token):
            self.why = "not signed in to the LWK Viewer (LWK Issues > Sign in)"
            return
        if not self.project:
            self.why = ("no viewer project chosen for this model yet - open LWK Issues once "
                        "and pick the project")
            return
        self.client = L.Client(base, token)
        self.me = st.get("name") or ""
        self.ok = True

    def refresh(self):
        """Read the project's items again. False (and why) when it cannot."""
        if not self.ok:
            return False
        try:
            self.items = self.client.items(self.project) or []
            return True
        except Exception as ex:
            self.why = "the viewer could not be reached: %s" % ex
            return False

    def accepted(self):
        return shared.accepted_from(self.items)

    def queue(self):
        return shared.queue_from(self.items)

    def put(self, item):
        if not self.ok:
            return None
        try:
            got = self.client.put_item(self.project, item)
            self._keep(got or item)
            return got
        except Exception as ex:
            self.why = "could not save to the viewer: %s" % ex
            return None

    def delete(self, item_id):
        if not self.ok:
            return False
        try:
            self.client.delete_item(self.project, item_id)
            self.items = [it for it in self.items if it.get("id") != item_id]
            return True
        except Exception as ex:
            self.why = "could not remove it on the viewer: %s" % ex
            return False

    def _keep(self, item):
        self.items = [it for it in self.items if it.get("id") != item.get("id")] + [item]
