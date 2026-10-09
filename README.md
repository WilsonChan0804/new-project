# Trip Planner: Hong Kong & Japan

A phone-friendly trip planner that works offline. There's no server and no login. Your plan is saved on the device and syncs through your own small server (see below).

## What it does
- **Day-by-day plan.** Every item gets one-tap links that are built from the details you enter:
  - Google Maps location, transit route from the previous stop, and directions from where you are now
  - Flights: live flight status (Flightradar24 / Google) and airport terminal maps
  - Trains and buses: route and timetable, station maps (searches 構内図 for Japan and exit maps for HK), MTR planner and Jorudan
  - Food: Tabelog (Japan), OpenRice (HK) and Google reviews. Other places get a "Food nearby" link.
  - Hotel or booking websites, plus any extra links you add
  - A "Whole day route" map and a weather link for each day
- **Built for changing plans**
  - Mark items done or skipped. On today's plan the next item is highlighted.
  - **⏱ Delay** pushes an item and everything after it later in one tap (+15/30/60 min…)
  - **Plan B** for each item, with a one-tap switch to it
  - Move items between days, reorder, copy, or sort a day by time
  - **Ideas** tab holds places you might visit (rainy-day options, spare time). If you delete a day, its items move here.
  - **Undo** works for every change
- **Offline**
  - The app files are cached by a service worker. Your plan is saved in browser storage.
  - **📷 Attach** saves screenshots (tickets, QR codes, station maps) on your device so you can see them without signal
  - **🚕 Show driver** shows the Japanese or Chinese name and address in large text
  - **Bookings** tab lists every confirmation number with a copy button
  - **Export/Import** creates a JSON backup (attachments included) that you can move to another device

## Use it on your phone
The site has to be served over https once for offline mode to work. The easiest way is GitHub Pages:
1. Go to the repo on GitHub, then **Settings → Pages → Deploy from branch → `main` / root**.
2. Open `https://<user>.github.io/<repo>/` on your phone.
3. Add it to your Home Screen: in Safari use **Share → Add to Home Screen**, in Chrome use **⋮ → Add to Home screen**.
4. Open it once while you're online. After that it works with no network.

To run it locally: `python3 -m http.server` and then open http://localhost:8000.

## Your itinerary
The Tokyo trip (29/10–1/11) lives in `trip-data.js`. The `XL` block holds the exact wording from `1007_Tokyo_Itinerary.xlsx`: 活動 (activity), 備註 (notes), 交通 (transport), and 預約/地圖 URL (booking/map URL). The app adds Japanese names, menus, Tabelog summaries, photos and map queries on top. If you change `trip-data.js`, increase `seedVersion` and the app will offer to load the new version.

- **Excel:** the 資訊 (Info) tab can export and import the same 8-column sheet. On import, rows are matched by 活動 (activity) or by 開始 (start time), so photos, menus and Tabelog data on matched rows are kept. It uses SheetJS (`vendor/xlsx.full.min.js`, Apache-2.0).
- **Map:** the interactive map uses Leaflet (`vendor/leaflet`, BSD-2-Clause). It can zoom offline up to level 17 and shows up to 19 by enlarging. Addresses are located with the GSI address search, and you can fix a pin by tapping the map, using your GPS, or pasting coordinates from Google Maps.
- **Offline:** use "下載離線資料" (download offline data) in Info. It saves the photos, Esri World Street Map tiles (OpenStreetMap as backup), Nominatim coordinates and walking routes (routing.openstreetmap.de) for every stop. The GPS dot works with no network.
- **Weather:** comes from Open-Meteo. The last result is cached so it still shows offline.

## Editing
- **Edit in place:** tap any text in an item's details (活動, 交通, 備註, URL, 地址, 營業時間, Tabelog, 菜單, 時刻表, 其他連結, 後備方案…) or a day's title or notes, change it, then tap 儲存 (save). Ctrl/⌘+Enter saves on a computer. Every URL in any text becomes a clickable link.
- **Photos:** every item has 加相 (add photo). On a computer, drag any photo with the mouse to reorder it. On a phone, tap ⇄ 排次序／隱藏 (reorder/hide), then hold and drag with your finger. That mode also has 🙈 隱藏 (hide, can be undone with 👁 顯示) and 🗑 刪除 (delete, for your own photos). The photo viewer has the same buttons.
- **Japanese (日語) tab:** tap ✎ 加／改句子 to add, edit or delete phrases and categories. Furigana appears above kanji, with rōmaji underneath. Readings for the built-in phrases and place names are in `readings.js`. For new phrases, the server generates them with pykakasi, and you can correct them by hand.
- **Map links on iPhone:** the first time you tap a map link, the app asks whether to open Google Maps App (`comgooglemapsurl://`), Apple Maps, or the web version. You can change this in 資訊 (Info).

## Server (your own VM): one copy of the data for every device
`server/trip_server.py` uses only the Python standard library. It serves the app and stores:
- the itinerary in `~/trip-data/trip.json`, with the last 300 versions kept in `~/trip-data/history/`
- photos in `~/trip-data/photos/`

On first start it imports `data/trip.json` from this repo.

To set it up, copy this folder to the VM as `~/trip-app` and run `bash ~/trip-app/deploy/setup-vm.sh`. The script:
- installs pykakasi in a venv
- creates an edit password in `~/trip-data/env`
- installs a systemd service called `trip-app`
- installs Caddy for HTTPS at `https://trip.<ip-with-dashes>.sslip.io/`

To update the app later, copy the folder again and run the script again. Your data in `~/trip-data` is not touched.

API:
- `GET /api/trip`, `PUT /api/trip` (with `baseRev`; returns 409 on conflict)
- `GET` and `PUT /api/photos/<id>`
- `POST /api/reading`
- `GET /api/ping`

Writes need the `X-Trip-Key` header. Reads are public unless you set `TRIP_VIEW_KEY`.

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
