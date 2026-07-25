# A Lovely Day

> *Less scrolling, more living.*

A browser extension for Firefox and Chrome/Brave that helps you spend time online more intentionally — track time on any website, block distracting content on Facebook, and lock yourself out of any site for the day.

---

## Features

- **Floating timer** — a draggable clock shows how long you've been on the current site. Counts down if a time limit is set.
- **Time limits** — set a daily limit per site. When time's up, the site locks automatically.
- **Site lock** — lock any site for the rest of the day with one tap. Unlock requires a deliberate action.
- **Facebook blocking** — hide Reels, Stories, short videos, and all video posts in your feed.
- **Statistics** — see today's usage and a 7-day chart per site in the popup.
- **Import / Export** — backup and restore your data as CSV.
- **Multi-language** — English, Tiếng Việt, Français (follows browser language).

---

## Installation

### Firefox
1. Run `build-ff.bat` → produces `dist/a-lovely-day-firefox.xpi`
2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**
3. Select the `.xpi` file

*Or install from [Firefox Add-ons](https://addons.mozilla.org) once published.*

### Chrome / Brave
1. Run `build-ch.bat` → produces `dist/a-lovely-day-chrome.zip`
2. Open `chrome://extensions/` → enable **Developer mode**
3. **Load unpacked** → select the `fbhelper` folder

*Or install from the Chrome Web Store once published.*

---

## Usage

| What | How |
|---|---|
| See time on current site | Floating clock — always visible |
| Set a time limit | Popup → Settings → Time Limit → enter h:m → Set |
| Lock a site now | Click the lock icon on the floating clock |
| Unlock | Lock screen → Unlock |
| Block Facebook Reels | Popup → Settings → Facebook Blocking Options |
| Export data | Popup → Import / Export / Clear |

---

## Privacy

- All data is stored **locally** on your device (`chrome.storage.local`).
- Time limits sync across your devices via `chrome.storage.sync` (optional, uses your browser account).
- No external servers. No analytics. No tracking.

---

## Build

```
build-ff.bat   →  dist/a-lovely-day-firefox.xpi
build-ch.bat   →  dist/a-lovely-day-chrome.zip
```

---

## License

MIT
