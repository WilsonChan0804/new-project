"""The manual's pictures: what each one shows and what its numbers mean,
in English and Cantonese. `python3 spec.py` writes shots.json for
shoot.mjs; build_manual.py reads the same file for the legends.

A mark: (selector or [x, y, w, h], English, Cantonese[, options]).
"""
import json
import os

TOOLS = [
    ("select", "Select (V): pick, move and change mark-ups", "揀選 (V)：揀、搬同改 mark-up"),
    ("pan", "Pan (H): move the sheet", "移動 (H)：拖動張圖"),
    ("rect", "Rectangle (B)", "長方形 (B)"),
    ("ellipse", "Circle (O)", "圓形 (O)"),
    ("line", "Line (L)", "直線 (L)"),
    ("arrow", "Arrow (A)", "箭咀 (A)"),
    ("cloud", "Cloud (C) - the usual issue mark", "雲線 (C) - 最常用嚟標 issue"),
    ("cloudpoly", "Cloud, free shape (Shift+C)", "自由形雲線 (Shift+C)"),
    ("polyline", "Polyline (P)", "多段線 (P)"),
    ("polygon", "Polygon (G)", "多邊形 (G)"),
    ("pen", "Pen (F): freehand", "筆 (F)：手繪"),
    ("highlight", "Highlighter (I)", "螢光筆 (I)"),
    ("text", "Text (T)", "文字 (T)"),
    ("textbox", "Text box (X)", "文字框 (X)"),
    ("callout", "Callout (K): text with a leader", "引線標註 (K)"),
    ("stamp", "Stamp (S): Approved, Rejected ...", "印章 (S)：Approved、Rejected ..."),
    ("measure", "Measure (M): a length, at the sheet's scale", "量度 (M)：按圖則比例量長度"),
    ("dimension", "Dimension (D)", "尺寸線 (D)"),
    ("snip", "Snip (Q): a picture of part of the sheet", "截圖 (Q)：截取部分圖則"),
    ("selecttext", "Select text (Y) on the drawing", "揀選圖上文字 (Y)"),
    ("area", "Area (E)", "面積 (E)"),
    ("angle", "Angle (U)", "角度 (U)"),
    ("eraser", "Eraser (W)", "擦膠 (W)"),
    ("match", "Match properties (J): copy one mark-up's look to others", "套用格式 (J)：將一個 mark-up 嘅樣式抄去其他"),
]

SHOTS = [
    dict(id="header", url="index.html?project={project}", ready="#sheet-list li", clip=[0, 0, 1440, 64], marks=[
        ([104, 6, 500, 30], "The pages: Projects, Sheets, 3D, Board, Tasks, Chat (red: unread), Calendar, Folders, Dashboard",
         "各頁：Projects、Sheets、3D、Board、Tasks、Chat（紅色數字：未讀）、Calendar、Folders、Dashboard"),
        ("select.two-proj", "The project you are working in", "你而家用緊嘅 project"),
        ("select.two-part", "Which part of the project (its model and sheets, or another part)", "project 嘅邊部分（model 同圖則，或者其他部分）"),
        ("#mode-comment", "Comment: what you draw is a comment", "Comment：畫嘅嘢係 comment"),
        ("#mode-issue", "Issue: what you draw is an issue (numbered, with status and owner)", "Issue：畫嘅嘢係 issue（有編號、狀態同負責人）"),
        ("#files-btn", "Files: download PDFs, import PDF / CAD, BCF, export", "Files：下載 PDF、匯入 PDF / CAD、BCF、匯出"),
        ("#lwk-search-btn", "Search everything (Ctrl+K)", "搜尋全部 (Ctrl+K)"),
        ("#lwk-help-btn", "Help - this manual, searchable", "Help - 呢本手冊，可以搜尋"),
        ("#lwk-bell", "Notifications", "通知"),
        ("#lwk-send-task", "+ Task: give someone a task", "+ Task：派 task 俾人"),
        ("#lwk-me", "Your profile: name, password, dark mode, sign out", "你嘅資料：名、密碼、深色模式、登出"),
    ]),
    dict(id="sheets", url="index.html?project={project}", ready="#sheet-list li", prep=[{"click": "#sheet-list li"}, {"wait": 2500}], marks=[
        ("#sheet-list", "The sheets - click one to open it", "圖則清單 - 撳一張打開"),
        ("#sheet-find", "Search sheet numbers, names and the words on the drawings", "搜尋圖號、圖名同圖上嘅字"),
        ("#set-menu-btn", "Sheet sets: pick several, rename, archive, delete", "圖則組：揀幾張、改名、封存、刪除"),
        ("#tools", "The mark-up tools (next picture)", "Mark-up 工具（下一張圖）"),
        ("#view-menu-btn", "View: split, compare two versions, sync, links between sheets", "View：分割、比較兩個版本、同步、圖則之間嘅連結"),
        ("#undo", "Undo / redo", "復原 / 重做"),
        ("#zoom-label", "Rotate, zoom out / in, Fit", "旋轉、縮小 / 放大、Fit"),
        ("#page", "The sheet, with its issues and comments - click one to open it", "圖則，連 issue 同 comment - 撳一個打開", {"at": "tl"}),
        ("#filter-tabs", "All / Issues / Comments", "全部 / Issues / Comments"),
        ("#show-markups", "Show or hide the mark-ups on the drawing", "顯示或隱藏圖上嘅 mark-up"),
        ("#hide-done", "Hide closed issues", "隱藏已關閉嘅 issue"),
        ("#group-by", "Group the list by sheet, status, person ...", "按圖則、狀態、人 ... 分組"),
        ("#item-search", "Search the issues and comments", "搜尋 issue 同 comment"),
        ("#filter-bar", "Filter by type and status; sort", "按類型同狀態篩選；排序"),
        ("#item-list > li", "An issue: number, title, who, when, status - click to open it", "一個 issue：編號、標題、邊個、幾時、狀態 - 撳一下打開", {"nth": 1}),
        ("#sheet-link", "Copy a link to this sheet", "複製呢張圖嘅連結"),
    ]),
    dict(id="markup-tools", url="index.html?project={project}", ready="#sheet-list li", prep=[{"click": "#sheet-list li"}, {"wait": 1500}],
         clip={"sel": "#tools", "pad": [0, 0, 30, 0]}, marks=[("button[data-tool=%s]" % k, en, yue, {"at": "below"}) for k, en, yue in TOOLS]
         + [("#keys-btn", "Keyboard shortcuts", "快捷鍵", {"at": "below"})]),
    dict(id="model", url="model.html?project={project}", ready="#model-list li", wait=6000, marks=[
        ("#m-nav", "Navigate: orbit, pan and zoom the model", "Navigate：轉動、移動、縮放 model"),
        ("#m-issue", "Add issue: click the model to place an issue", "Add issue：撳 model 放一個 issue"),
        ("#m-measure", "Measure with snapping", "量度（會鎖點）"),
        ("#floor-select", "Floor plan: cut the model at a floor", "樓層平面：喺某層切開 model"),
        ("#plan-draw", "Plan overlay: lay the sheet over the model", "平面疊圖：將圖則疊喺 model 上"),
        ("#view-link", "Copy a link to this view", "複製呢個視圖嘅連結"),
        ("#bcf-menu", "BCF: exchange issues with Revit, Navisworks ...", "BCF：同 Revit、Navisworks ... 交換 issue"),
        ("#model-list", "The project's models - tick to show", "Project 嘅 model - 剔選顯示"),
        ("#ref-panel", "Consultant models (IFC) and other projects laid over", "顧問 model (IFC) 同疊加其他 project"),
        ("#cat-list", "Elements: show or hide each category", "構件：顯示或隱藏每個類別"),
        ("#mb-panel", "Model browser: find, select, isolate, zoom to elements", "Model browser：搵、揀、單獨顯示、放大構件"),
        ("#viewcube", "The view cube: click a face; Home for the overview", "視圖方塊：撳一面；Home 返總覽"),
        ("#viewcube-bar", "Walk, Fit, Perspective / Orthographic, Set front, World", "Walk、Fit、透視 / 正投影、Set front、World"),
        ("#inspect-body", "Selection: the clicked element's properties; Isolate, Hide, Show all", "Selection：撳中構件嘅屬性；Isolate、Hide、Show all"),
        ("#pins-toggle", "Show or hide the issue pins in the model", "顯示或隱藏 model 入面嘅 issue 釘"),
        ("#i3-list", "Issues in 3D: the list, with filters", "3D 入面嘅 issue：清單同篩選"),
    ]),
    dict(id="model-sbd", url="model.html?project={project}", ready="#model-list li", wait=6000, size=[1440, 1300],
         storage={"lwk.panels.model": '{"l":{"w":430}}'},
         prep=[{"click": "#chk-tab-sbd"}, {"wait": 2500},
               {"eval": "for (const e of document.querySelectorAll('#models *')) if (getComputedStyle(e).position === 'sticky') e.style.position = 'static'; const m=document.querySelector('#models'), h=document.querySelector('#chk-panel').previousElementSibling; m.scrollTop += h.getBoundingClientRect().top - m.getBoundingClientRect().top"}, {"wait": 500}],
         clip={"sel": "#models", "bottom": "#sbd-cadin"}, marks=[
        ("#chk-tab-sbd", "Checks > SBD (Clash and Headroom beside it)", "Checks > SBD（旁邊有 Clash 同 Headroom）"),
        ("#sbd-run", "Run the check again", "再計一次"),
        ("#sbd-levels", "Plan level for each zone (all levels, or one height)", "每個區嘅平面高度（全部，或者某一個高度）"),
        ("#sbd-saved", "Latest run, or a saved result; Save keeps this one", "最新結果，或者已儲存嘅；Save 保存呢個"),
        (".sbd-verdict", "Permeability: P against the required P - PASS or FAIL", "透風度：P 對比要求 - PASS 或 FAIL"),
        (".sbd-verdict", "Design Requirement (1): Lp against 5U", "設計要求 (1)：Lp 對比 5U", {"nth": 1}),
        (".sbd-t", "P on Plane X and Y per zone - red: does not comply, green: complies", "每個區 Plane X 同 Y 嘅 P - 紅色：唔符合，綠色：符合"),
        (".sbd-legend", "What the colours mean", "顏色嘅意思"),
        ("#sbd-plan", "Plan ...: plans, elevations and street canyons of each zone", "Plan ...：每個區嘅平面、立面同街道峽谷"),
        ("#sbd-3d", "3D: show or hide the SBD masses and zone limits in the model", "3D：喺 model 顯示或隱藏 SBD mass 同高度區界線", {"box": True}),
        ("#sbd-issue", "Make issue: an issue for what fails", "Make issue：為唔合格嘅地方開 issue"),
        ("#sbd-report", "Report: every zone's plan and working, to print", "Report：每個區嘅平面同計算，可以列印"),
        ("#sbd-cad", "CAD ...: every drawing as DXF or DWG", "CAD ...：所有圖輸出 DXF 或 DWG"),
        ("#sbd-remove", "Remove the masses and the result", "刪除 mass 同結果"),
        (".sbd-tpl", "CAD template: draw the model in CAD (no Revit)", "CAD template：用 CAD 畫 model（冇 Revit 都得）"),
        ("#sbd-cadin", "Import CAD model: the drawing becomes the SBD model", "Import CAD model：張圖變成 SBD model"),
    ]),
    dict(id="sbd-plan", url="model.html?project={project}", ready="#model-list li", wait=6000,
         prep=[{"click": "#chk-tab-sbd"}, {"wait": 2500}, {"eval": "document.querySelector('#sbd-plan').scrollIntoView()"}, {"click": "#sbd-plan"}, {"waitFor": ".sbd-win svg"}, {"wait": 800}],
         clip=".sbd-win", marks=[
        ("[data-v=plan]", "Plan / Elevation / Street canyon", "平面 / 立面 / 街道峽谷"),
        ("[data-a=axis1]", "Projection Plane X or Y", "投影面 X 或 Y"),
        ("[data-z=LOW]", "The zones, each with its P", "各高度區，連 P"),
        ("[data-cadv=dxf]", "This drawing as DXF or DWG", "呢張圖輸出 DXF 或 DWG"),
        ("[data-x]", "Close", "關閉"),
        (".sbd-plan", "The drawing: gaps S1, S2 ... hatched, the planes, dimensions", "圖：S1、S2 ... 空隙加陰影、投影面、尺寸", {"at": "tl"}),
        (".sbd-gaps", "The working: each gap's area, depth and S", "計算：每個空隙嘅面積、深度同 S"),
        ("[data-zm=fit]", "Zoom in / out, Fit", "放大 / 縮小、Fit"),
    ]),
    dict(id="board", url="board.html?project={project}", ready="#bd-tools", wait=2500, marks=[
        ("#bd-menu", "Boards: all the project's boards, new board, templates", "Boards：project 所有白板、新白板、範本"),
        ("#bd-title", "The board's name", "白板名稱"),
        ("#bd-people", "Who is on the board now", "而家邊個喺白板"),
        ("#bd-search-btn", "Find text on the board", "搵白板上嘅字"),
        ("#bd-timer-btn", "A countdown for everyone", "大家一齊睇嘅倒數計時"),
        ("#bd-present", "Present: frame by frame", "Present：逐個框展示"),
        ("#bd-export", "Export: picture, PDF, backup", "Export：圖片、PDF、備份"),
        ("[data-tool=select]", "Select and move; move the board", "揀選同移動；拖動白板"),
        ("[data-tool=sticky]", "Sticky note, text, shape, connector, mind map, pen", "便條、文字、形狀、連接線、思維圖、筆"),
        ("[data-tool=frame]", "Frame, picture, card linked to an issue or a sheet", "框、圖片、連去 issue 或圖則嘅卡"),
        ("[data-tool=undo]", "Undo / redo", "復原 / 重做"),
        ([380, 355, 680, 245], "The board: double-click to write", "白板：雙擊寫字", {"at": "tl"}),
        ("#bd-zoom", "Overview map, zoom, Fit", "總覽地圖、縮放、Fit"),
    ]),
    dict(id="tasks", url="tasks.html?list={list}", ready=".tl-row[data-id]", marks=[
        ("[data-quick=owned]", "Owned, Subscribed, Activities: your tasks", "Owned、Subscribed、Activities：你嘅 task"),
        ("[data-quick=all]", "Quick access: all, created, assigned, completed", "快速篩選：全部、你開嘅、派俾人嘅、完成咗"),
        ("#t-lists", "The task lists (+ makes one)", "Task list（+ 開新嘅）"),
        ("[data-mode=people]", "People: everyone's tasks", "People：每個人嘅 task"),
        ("#t-tabs", "List, Kanban, Gantt, Dashboard, Activities", "List、Kanban、Gantt、Dashboard、Activities"),
        ("#t-share", "Members of the list", "List 成員"),
        ("#t-new", "+ New task (▾: import)", "+ New task（▾：匯入）"),
        ("#f-q", "Search tasks", "搜尋 task"),
        ("#t-bar .flt-btn", "Filter: status, owner, priority, sort, group by", "Filter：狀態、負責人、優先、排序、分組"),
        ("#t-cols", "Customize the columns", "自訂欄位"),
        (".tl-head .tl-sortable[data-sort=priority]", "Click a heading to sort (▲ ▼)", "撳欄頭排序 (▲ ▼)"),
        (".tl-gh", "A group (a project): fold it, open its sheets and dashboard", "一個 group（project）：收埋、打開佢嘅圖則同 dashboard"),
        (".tl-row[data-id] .tick", "Tick to complete", "剔咗就完成"),
        (".tl-row[data-id] .tl-t", "The title - click to open the task", "標題 - 撳一下打開 task"),
        (".tl-row[data-id] [data-col=owners]", "Edit any cell where it stands", "任何格都可以直接改"),
    ]),
    dict(id="task-detail", url="tasks.html?list={list}", ready=".tl-row[data-id]", prep=[{"click": ".tl-row[data-id] .tl-t"}, {"waitFor": "#t-detail .td-top"}, {"wait": 600}],
         clip="#t-detail", marks=[
        (".td-done", "Mark complete", "標記完成"),
        ("[data-act=prev]", "Previous / next task (K / J)", "上一個 / 下一個 task (K / J)"),
        ("[data-act=follow]", "Follow: e-mails when it changes", "Follow：有改動會收 email"),
        ("[data-act=share]", "Share to a chat", "分享去 chat"),
        ("[data-act=copy]", "Copy a link to the task", "複製 task 連結"),
        ("[data-act=delete]", "Delete (Ctrl+Z brings it back)", "刪除（Ctrl+Z 攞返）"),
        (".td-title", "The title", "標題"),
        ("[data-act=owners]", "Owners, dates, group, priority and the list's own fields", "負責人、日期、group、優先同 list 自己嘅欄"),
        (".td-desc", "Description", "描述"),
        (".td-subs", "Sub-tasks", "Sub-task"),
        ("[data-act=linkissue]", "Linked issues, sheets, 3D views and files", "連結嘅 issue、圖則、3D 視圖同檔案"),
    ]),
    dict(id="chat", url="messenger.html", ready="#c-rooms .cr", marks=[
        ("#c-q", "Search chats (Enter: search the messages)", "搜尋 chat（Enter：搜尋訊息）"),
        ("#c-new", "New chat: a message to someone, or a group", "新 chat：私訊或者 group"),
        ("#c-rooms .cr", "Project channels - one per project", "Project channel - 每個 project 一個"),
        ("#c-rooms .cr", "Groups and direct messages", "Group 同私訊", {"nth": 1}),
        ("#c-rooms .cr", "Task discussions", "Task 討論", {"nth": 2}),
        ("#c-links", "Open the project, its sheets or 3D", "打開 project、圖則或者 3D"),
        ("#c-files-btn", "Files sent in the chat", "Chat 入面嘅檔案"),
        ("#c-members-btn", "Members", "成員"),
        ("#c-topics", "Topics: sub-channels for one subject", "Topic：單一題目嘅子 channel"),
        ("#c-msgs", "The messages", "訊息", {"at": "tl"}),
        ("#c-text", "Write: @ person, # task, ! issue, $ sheet, % 3D view", "寫訊息：@ 人、# task、! issue、$ 圖則、% 3D 視圖"),
        ("#c-fmtbar", "Bold, lists, quote, link, code", "粗體、列表、引用、連結、程式碼"),
        ("#c-emoji", "Emoji, mention, link, files, poll / event / task", "表情、提及、連結、檔案、投票 / 活動 / task"),
        ("#c-send", "Send (Enter)", "傳送 (Enter)"),
    ]),
    dict(id="calendar", url="calendar.html", ready="#cal-body", marks=[
        ("#cal-today", "Previous / Today / Next month", "上個月 / 今日 / 下個月"),
        ("#cal-title", "The month shown", "顯示緊嘅月份"),
        ("#cal-hol", "Public holidays (HK, PH ...)", "公眾假期（香港、菲律賓 ...）"),
        ("#cal-groups", "Groups: see a team's leave and meetings", "Groups：睇一個團隊嘅假期同會議"),
        ("#cal-leave", "+ Leave", "+ 請假"),
        ("#cal-view", "Month or List", "月曆或清單"),
        ("#cal-new", "+ Event: a meeting", "+ Event：會議"),
        ("#cal-outlook", "Add to Outlook: the calendar in Outlook", "Add to Outlook：喺 Outlook 睇呢個日曆"),
        ("a.ce.task", "Your tasks on their due dates - click to open", "你嘅 task 喺到期日 - 撳一下打開"),
    ]),
    dict(id="folders", url="folders.html?project={project}", ready="#fo-list .fo-row", marks=[
        ("#fo-proj", "The project", "Project"),
        ("[data-q=pinned]", "Pinned, Starred, Recent, Recently deleted", "釘選、星號、最近、最近刪除"),
        ("#fo-tree", "The folders (drag files here to move them)", "資料夾（拖檔案嚟搬）"),
        ("#fo-side-open", "Hide or show the folders", "隱藏或顯示資料夾"),
        ("#fo-crumbs", "Where you are", "而家喺邊"),
        ("#fo-search", "Search this project's files", "搜尋呢個 project 嘅檔案"),
        ("#fo-newdir", "+ Folder", "+ 資料夾"),
        ("#fo-up", "Upload (or drop files on the page)", "上載（或者拖檔案入頁面）"),
        ("#fo-list .fo-head", "Click a heading to sort", "撳欄頭排序"),
        ("#fo-list .fo-row", "The locked 00 BIM folder: the sheets and models from Revit", "鎖住嘅 00 BIM：由 Revit 嚟嘅圖則同 model"),
        ("#fo-list .fo-dots", "More: rename, move, versions, pin, star, delete", "更多：改名、搬、版本、釘選、星號、刪除", {"nth": 2}),
    ]),
    dict(id="dashboard", url="dashboard.html?project={project}", ready="#kpis", wait=2500, marks=[
        ("#f-range", "Closed within", "幾耐內關閉"),
        ("#f-type", "Type, assignee, office, team, discipline", "類型、負責人、辦公室、團隊、專業"),
        ("#f-mine", "Only mine", "只睇自己"),
        ("#d-export", "Export: report, CSV, BCF, weekly summary", "Export：報告、CSV、BCF、每週摘要"),
        ("#d-tasks", "The project's tasks", "Project 嘅 task"),
        ("#digest", "This week: raised, closed, open, overdue", "今個星期：新開、關閉、未完、過期"),
        ("#kpis", "The issue counts - click one to see them", "Issue 數字 - 撳一個睇清單"),
        ("#c-trend", "Raised and closed by week", "每星期新開同關閉"),
    ]),
    dict(id="projects", url="projects.html", ready="#t-view", clip=[0, 0, 1440, 290], marks=[
        ("#pj-q", "Search projects or people", "搜尋 project 或者人"),
        ("#pj-status", "Status: Active, On hold, Completed, Archived", "狀態：Active、On hold、Completed、Archived"),
        ("#pj-sort", "Sort (or click a heading)", "排序（或者撳欄頭）"),
        ("#pj-manage", "Manage projects (admins)", "管理 project（admin）"),
        ("#t-view .pj-row, #t-view tr", "A project: click its name for its page", "一個 project：撳名打開佢嘅頁", {"nth": 1}),
        ("#t-view .pj-vl", "Open its Sheets, 3D, Chat, Dashboard, Folders", "打開佢嘅 Sheets、3D、Chat、Dashboard、Folders"),
    ]),
]


def legend(shot_id, lang):
    """[(number, text)] of a picture's marks."""
    for s in SHOTS:
        if s["id"] == shot_id:
            return [(i + 1, m[1] if lang == "en" else m[2]) for i, m in enumerate(s["marks"])]
    raise KeyError(shot_id)


def to_json():
    out = []
    for s in SHOTS:
        d = {k: v for k, v in s.items() if k != "marks"}
        d["marks"] = []
        for m in s["marks"]:
            mk = {"rect": m[0]} if isinstance(m[0], list) else {"sel": m[0]}
            mk["en"], mk["yue"] = m[1], m[2]
            if len(m) > 3:
                mk.update(m[3])
            d["marks"].append(mk)
        out.append(d)
    return {"shots": out}


if __name__ == "__main__":
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots.json"), "w", encoding="utf-8") as f:
        json.dump(to_json(), f, ensure_ascii=False, indent=1)
    print(len(SHOTS), "pictures,", sum(len(s["marks"]) for s in SHOTS), "marks")
