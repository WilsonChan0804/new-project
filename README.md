# Twofold

A private space for two: record moments, keep posts and links from other apps, plan your calendar, chat, and make stickers from photos. The design follows the "Couple App UI" mock-ups, in light and dark mode. Works on computer and iPhone as an installable web app (PWA).

## Put it online with Cloudflare (free) — recommended

One Cloudflare Worker serves the app over https, so it works on iPhone and computers. The same Worker runs the encrypted sync relay that lets you and your partner share messages, moments, plans, the shopping list and the cat diary. It fits the Workers Free plan. No database needs creating: storage is a Durable Object with SQLite, set up on deploy.

1. Create a free account at **dash.cloudflare.com**. The first time, it asks you to pick a `workers.dev` subdomain (e.g. `wilson`).
2. Go to **Workers & Pages → Create → Import a repository**. Connect GitHub and allow access to this repository. The repo can stay private.
3. Choose this repository. Set the **production branch** to the branch that has the app, keep the deploy command `npx wrangler deploy`, and leave the build command empty.
4. Press **Deploy**. You get an address like `https://twofold.<your-subdomain>.workers.dev`.
5. Open that address on your iPhone in Safari → **Share → Add to Home Screen**. Do the same on your partner's phone and on your computers.
6. In **Us → Settings → Sync with your partner**, tap **Create our private space** and send the invite link to your partner (and to your own other devices). Opening the link joins the space.

Every new commit to the branch redeploys automatically.

**How the privacy works:** a random 256-bit key is created on the first device. From it, each device derives the space id, an access token and the AES-GCM key that encrypts every record and file before it leaves the device. The key is only ever in your devices and in the invite link (after the `#`, which browsers never send to the server). The relay stores encrypted data only. `MAX_SPACES` in `wrangler.toml` (default 2) stops strangers from creating spaces on your server.

**Free-plan limits (checked October 2026):** 100,000 requests per day, and SQLite storage shared across Durable Objects (several GB). Big photos and videos are stored as encrypted 1 MB parts. A couple's daily use is far below these limits. Every device keeps a full copy, so if the server is ever unavailable the app keeps working and syncs again later.

## Run it on your computer only

Some features need the app to be served from a web address rather than opened as a file: photo scanning, the AI sticker cut-out and offline mode. Double-clicking `index.html` is not enough.

- **Windows:** double-click `app/Start Twofold (Windows).bat`. It starts a small local server with PowerShell (nothing to install) and opens the app. Keep the black window open while you use it.
- **Mac:** double-click `app/Start Twofold (Mac).command` (uses `python3`).
- **iPhone:** host the `app/` folder on any HTTPS address (e.g. GitHub Pages, Netlify), open it in Safari, then **Share → Add to Home Screen**.

Data is stored per address. If you used the app as a file before, open the old copy, use **Download backup**, then **Restore backup** in the new one.

## What's in it

| Screen | Features |
| --- | --- |
| First run | "A private space for just you two": names, together-since date, or restore a backup. Language toggle (English / 廣東話). |
| Home | Greeting with both avatars, days-together card with the next countdown (anniversary, birthdays incl. the cat's, plans, vet reminders), a heart "nudge", today's moment prompt, a shopping card, and recent moments. |
| Chat | Multi-line messages (Enter sends on a computer, Shift+Enter for a new line; the return key adds a line on phones; Chinese input methods are respected). Emoji panel, stickers by group, photos, videos, voice messages, speech-to-text (Cantonese / Mandarin / English). Tap a message to copy, edit, delete (with Undo) or save it to Moments. Select several messages (text, photos, videos, links) to make one moment. Quick replies you can edit, chat backgrounds (colours, patterns or your own photo), rename and delete chats. **Messages are stored on this device only for now.** |
| + New moment | Several photos **and videos**, caption, mood, link/place/date/albums, optional share after saving. |
| Moments | + button, filters, search, "On this day", day-grouped tiles (videos show a ▶), detail view with reactions, share, edit and delete. |
| Us → Calendar | Photo days, plans, special dates, meals with ingredients, cat birthdays, cat diary entries and reminders. Plans export as `.ics` files. |
| Us → Shopping | Scan the meal-plan checklist photo (or paste text), review and fix, then a 2–3 column shopping list and a meal plan saved to the calendar. |
| Us → Cat | Cat profiles with their own picture, one-tap diary (tap a day to edit or delete entries), weight, meds/vaccine/vet/grooming with reminders, trend notes. **Cat break**: your cat clips take over the screen on demand (Alt+C), every N minutes, or when the computer is idle. "Pop out" floats it over other windows where the browser allows. |
| Us → Stickers | ✨ AI "Select subject" cut-out, Erase/Restore brushes, magic wand, edge softness, die-cut outline in white/black/rose, caption, and sticker groups. Circle/square/heart shapes too. |
| Us → Settings | Names and pictures (photo, emoji or sticker avatars), dates, language, appearance, backup. |

## Reading checklist photos

The photo is read **on the device** by Tesseract (bundled in `app/vendor`, about 9 MB, downloaded the first time you scan). It finds the spreadsheet grid and reads each cell several ways. It then snaps misread words to a list of common Hong Kong grocery items and to your own past corrections. Small Chinese text is hard for Tesseract, so always check the orange boxes. On iPhone, Live Text is more accurate: open the photo, long-press the text, then **Select All → Copy**, and use **Paste text** in the app.

## Limits

- **Cat break** can only cover the Twofold window, because a web page can't lock the whole computer. It works while the app is open, and asks to show notifications so it can call you from another window. Idle detection across the whole computer works in Chrome and Edge (it asks for permission); other browsers only notice idleness inside the app.
- **Speech-to-text** uses the browser's speech service: Chrome on a computer, or Safari. On iPhone, the keyboard's 🎤 key always works for Cantonese.
- **Notifications on iPhone** for new messages need Web Push, which isn't set up yet. Messages arrive when the app is open.

## Where your data lives

Everything is stored in the browser's IndexedDB on that device. Nothing is uploaded. Use **⤓ Backup** to download a `.json` file to your computer, and restore it on any device.

## Limits of connecting to other apps

- **Saving from other apps:** paste the link, or use the share sheet. On Android and desktop Chrome, the installed app shows up in the share sheet. iOS doesn't let web apps receive shares; that needs a native iOS app with a Share Extension.
- **Importing your whole history automatically** isn't possible for most of these apps. Instagram, Facebook, Threads, Reddit and IMDb either offer no public API for personal data or charge for it. Letterboxd's API is private. Instead, each service offers a "Download your data" export that a future importer could read.
- **Sending posts out** uses each app's official share links, plus the system share sheet, which can pass photos straight to Instagram or WhatsApp.
- **Real chat between people** needs a server for accounts and delivery, such as Firebase or Supabase. You can't send messages from inside the real WhatsApp, because WhatsApp has no personal messaging API.
