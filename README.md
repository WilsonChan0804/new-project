# Twofold

A private space for two: record moments, keep posts and links from other apps, plan your calendar, chat, and make stickers from photos. The design follows the "Couple App UI" mock-ups, in light and dark mode. Works on computer and iPhone as an installable web app (PWA).

## Run it

```bash
cd app
python3 -m http.server 8000
# open http://localhost:8000
```

To use it on iPhone, host the `app/` folder anywhere with HTTPS (e.g. GitHub Pages, Netlify, Cloudflare Pages), open it in Safari, then **Share → Add to Home Screen**.

## What's in it

| Screen | Features |
| --- | --- |
| First run | "A private space for just you two": enter your names and the date you got together, or restore a backup. |
| Home | Greeting, a days-together card with the next countdown ("Plan it" opens the calendar), a card for sending your partner a heart nudge, today's moment prompt with a Capture button, and recent moments. |
| Chat | Your partner's chat opens straight away. Quick replies, photos ("Save to Moments"), stickers, and other chats from the back arrow. **Messages are stored on this device only for now.** |
| + New moment | Photo stage with Camera and Choose/Add more, a caption, mood chips, and link, place, date and albums. "Share after saving" opens WhatsApp, Instagram or Messages. |
| Moments | All / Photos / Links / Loved filters, search, an "On this day" card, day-grouped photo tiles, a detail sheet with reactions and share/edit/delete, and a recap slideshow (▶). Links from Instagram, Threads, Facebook, Letterboxd, IMDb, Reddit, WhatsApp, YouTube, X, TikTok and Spotify are recognised. |
| Us → Calendar | Photo days, plans, special dates, meals with their ingredients, and cat diary entries and reminders. Plans export as `.ics` files. |
| Us → Shopping | Scan a photo of the meal-plan checklist (rows: `20261018` · dish · ingredients…), or paste its text. Check and fix what was read (unclear words are highlighted in orange, and fixes are remembered). You get a ticked-off shopping list in 2–3 columns, grouped by aisle, showing which days need each item. **Meal plan** mode shows each day's dish and ingredients and adds them to the calendar. |
| Us → Cat | Cat diary inspired by Moggie, Meowow and Cat Buddy. One-tap logs (ate, drank, litter, nap, play, affection, grumpy, vomit), weight, medicine/vaccine/vet/grooming with next-due reminders, and photo diary entries. Trend notes compare this week with your cat's usual pattern (not a diagnosis). |
| Us → Stickers / Settings | Sticker studio (circle, square, heart and cut-out shapes, outline, caption). Settings covers names, dates, Auto/Light/Dark appearance and backup. |

The fonts (Bricolage Grotesque and Inter) are bundled in `app/fonts` under the SIL Open Font License, so the app also works offline.

## Reading checklist photos

The photo is read **on the device** by Tesseract (bundled in `app/vendor`, about 9 MB, downloaded the first time you scan). It finds the spreadsheet grid and reads each cell several ways. It then snaps misread words to a list of common Hong Kong grocery items and to your own past corrections. Small Chinese text is hard for Tesseract, so always check the orange boxes. On iPhone, Live Text is more accurate: open the photo, long-press the text, then **Select All → Copy**, and use **Paste text** in the app.

## Where your data lives

Everything is stored in the browser's IndexedDB on that device. Nothing is uploaded. Use **⤓ Backup** to download a `.json` file to your computer, and restore it on any device.

## Limits of connecting to other apps

- **Saving from other apps:** paste the link, or use the share sheet. On Android and desktop Chrome, the installed app shows up in the share sheet. iOS doesn't let web apps receive shares; that needs a native iOS app with a Share Extension.
- **Importing your whole history automatically** isn't possible for most of these apps. Instagram, Facebook, Threads, Reddit and IMDb either offer no public API for personal data or charge for it. Letterboxd's API is private. Instead, each service offers a "Download your data" export that a future importer could read.
- **Sending posts out** uses each app's official share links, plus the system share sheet, which can pass photos straight to Instagram or WhatsApp.
- **Real chat between people** needs a server for accounts and delivery, such as Firebase or Supabase. You can't send messages from inside the real WhatsApp, because WhatsApp has no personal messaging API.
