# Moments

A personal app to record moments, keep posts/links from other apps, plan your calendar, chat, and make stickers from photos. Works on computer and iPhone as an installable web app (PWA).

## Run it

```bash
cd app
python3 -m http.server 8000
# open http://localhost:8000
```

To use it on iPhone, host the `app/` folder anywhere with HTTPS (e.g. GitHub Pages, Netlify, Cloudflare Pages), open it in Safari, then **Share → Add to Home Screen**.

## What's in it

| Tab | Features |
| --- | --- |
| Home | "Days together" counter and countdowns to birthdays, anniversaries, plans and every 100-day milestone. Quick Snap / Write / Save a link / Sticker buttons. A question of the day (answers become moments). "On this day" memories from past years, with Shuffle. A monthly recap with stats, a photo collage and a story-style slideshow. |
| Moments | A photo-first feed with swipeable photos, places, #albums and emoji reactions. Filter chips by photos, links, source app or album. Links from Instagram, Threads, Facebook, Letterboxd, IMDb, Reddit, WhatsApp, YouTube, X, TikTok and Spotify are recognised. The ••• menu shares through the system share sheet, posts to WhatsApp, Threads, Facebook, Reddit or X, and edits or deletes. |
| Calendar | Days with photos show the photo itself. Plans and special dates are colour-coded. Plans export as `.ics` files for Apple, Google or Outlook Calendar. |
| Chat | Chat list and conversation view with photos and your stickers. **Messages are stored on this device only for now.** |
| Stickers | Turn a photo into a sticker: circle, square, heart, or cut-out (tap to erase the background, with undo), a white outline and a caption. Share stickers to WhatsApp as images or download them as PNG files. |

Settings (gear icon on Home) holds your names, the "together since" date, special dates, and backup/restore.

Ideas adopted from similar apps: Between (day counter, special-date countdowns, private chat), Locket and Retro (photo-first sharing, recaps, resurfaced memories), and Amorly/Amourly (question of the day, shared journal).

## Where your data lives

Everything is stored in the browser's IndexedDB on that device. Nothing is uploaded. Use **⤓ Backup** to download a `.json` file to your computer, and restore it on any device.

## Limits of connecting to other apps

- **Saving from other apps:** paste the link, or use the share sheet. On Android and desktop Chrome, the installed app shows up in the share sheet. iOS doesn't let web apps receive shares; that needs a native iOS app with a Share Extension.
- **Importing your whole history automatically** isn't possible for most of these apps. Instagram, Facebook, Threads, Reddit and IMDb either offer no public API for personal data or charge for it. Letterboxd's API is private. Instead, each service offers a "Download your data" export that a future importer could read.
- **Sending posts out** uses each app's official share links, plus the system share sheet, which can pass photos straight to Instagram or WhatsApp.
- **Real chat between people** needs a server for accounts and delivery, such as Firebase or Supabase. You can't send messages from inside the real WhatsApp, because WhatsApp has no personal messaging API.
