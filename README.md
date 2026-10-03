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

## Loading your own itinerary
Use the in-app ✏️ / ＋ buttons, or import a JSON file shaped like this:

```json
{
  "name": "HK & Japan 2026",
  "days": [
    { "date": "2026-12-01", "city": "Hong Kong", "country": "HK", "title": "Arrive",
      "items": [
        { "type": "flight", "time": "07:35", "title": "Flight to HK", "number": "CX 123",
          "from": "Singapore Changi Airport", "to": "Hong Kong International Airport", "ref": "ABC123" },
        { "type": "hotel", "time": "15:00", "title": "Hotel ABC", "address": "...", "localName": "...",
          "url": "https://...", "ref": "12345" }
      ] }
  ],
  "ideas": []
}
```

Item `type` can be `flight`, `train`, `bus`, `ferry`, `hotel`, `food`, `sight`, `shop` or `other`.
Optional fields are `endTime`, `place`, `address`, `localName`, `url`, `ref`, `cost`, `notes`, `planB`, `country` (`HK`/`JP`) and `links: [{label, url}]`.

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
