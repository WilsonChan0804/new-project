# Trip Planner: Hong Kong & Japan

A phone-friendly trip planner that works offline. There's no server and no login. Your plan is saved on the device, and you can sync it through this GitHub repo (see below).

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

## Editing and sync (GitHub)
- **Edit in place:** tap any text in an item's details (活動, 交通, 備註, URL, 地址, 營業時間, Tabelog, 菜單, 時刻表, 其他連結, 後備方案…) or a day's title or notes, change it, then tap 儲存 (save). Ctrl/⌘+Enter saves on a computer. Every URL in any text becomes a clickable link.
- **Photos:** every item has 加相 (add photo). In the details sheet, ⇄ 排次序 (reorder) shows ◀ ▶ to move a photo and ✕ to hide a preset photo or delete your own.
- **Where the data lives:** with a GitHub token set in 資訊 → ☁️ GitHub 同步 (GitHub sync), every change is committed to this repo:
  - the itinerary goes to `data/trip.json`
  - your photos go to `data/photos/<id>.jpg`

  Other devices pull the data automatically, even without a token, because the repo is public. Future app versions read the same file, so your edits are kept. Use a fine-grained token limited to this repo with **Contents: Read and write**.
- **For developers:** run `git pull` before changing the app, so you include the data commits made from the app. To change the itinerary content after `data/trip.json` exists, edit `data/trip.json` instead of `trip-data.js`. `trip-data.js` is only the starting seed.

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
