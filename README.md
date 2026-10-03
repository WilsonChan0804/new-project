# Trip Planner: Hong Kong & Japan

A phone-friendly trip planner that works offline. There's no server and no login. Your plan stays on your own device.

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
The itinerary lives in `trip-data.js` (Cantonese, with Japanese names). The app loads it the first time it opens. After that, your edits are saved on the phone. If you change `trip-data.js`, increase `seedVersion` and the app will offer to load the new version.

Each item has a start and end time. **上移／下移** (move up/down) swaps the two time slots, and **⏱ 延遲** (delay) shifts everything after an item. The **＋** between items inserts a new item and pushes the later ones back.

Other fields:
- **Timetables:** `timetable: [{dep, arr, name, note}]`
- **Menus:** `menu: {items: [{name, ja, price, star, desc}]}`
- **Place photos:** `wiki: 'ja:根津神社'`. The photo is downloaded once and then kept for offline use.

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
