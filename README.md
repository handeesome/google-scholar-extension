# 💡 Google Scholar Tracker

A Chrome extension that tracks which academic papers you've visited on Google Scholar — and syncs them to your personal Notion database.

---

## Features

- **Automatic visit tracking** — highlights papers you've already visited directly on Google Scholar search results, showing visit count and last visited date
- **Color-coded highlights** — yellow for papers visited fewer than 5 times, red for 5 or more
- **Notion sync** — bidirectional sync with your own Notion database; exports local visits and imports remote entries
- **Auto-sync** — automatically pushes a paper to Notion the moment you click it, no manual sync needed
- **Per-user databases** — each user links their own Notion database; no shared data
- **Visit history page** — full table of all visited papers with title, authors, visit count, and timestamps; supports delete and clear all
- **Secure OAuth** — login is handled via Notion OAuth; the client secret never lives in the extension (proxied through a Cloudflare Worker)

---

## Project Structure

```
├── background.js        # Service worker: OAuth, Notion API, sync logic
├── content.js           # Injected into Google Scholar: highlighting & click tracking
├── popup.html/js        # Extension popup: visit count summary and quick navigation
├── history.html/js      # Full history page: table, sync controls, tutorial
├── styles.css           # Shared styles for history page
├── manifest.json        # Chrome extension manifest (MV3)
├── icons/               # Extension icons (16px, 48px, 128px)
└── images/              # Tutorial screenshots (tutorial-1.png … tutorial-6.png)
```

---

## Setup

### Prerequisites

- Google Chrome
- A [Notion](https://notion.so) account
- A [Cloudflare](https://cloudflare.com) account (free tier is sufficient)

---

### 1. Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration** and give it a name (e.g. _Google Scholar Tracker_)
3. Under **Type**, select **Public**
4. Set the **Redirect URI** to your Cloudflare Worker URL (see step 3 below) — you can update this after deploying
5. Copy the **Client ID** and **Client Secret**

---

### 2. Configure the Extension

Open `background.js` and set your values at the top of the file:

```js
const CLIENT_ID = "your-notion-client-id";
const WORKER_URL = "https://your-worker.your-subdomain.workers.dev";
```

> **Do not commit your Client Secret to GitHub.** It lives only in your Cloudflare Worker environment variables (see next step).

---

### 3. Deploy the Cloudflare Worker

The Worker acts as a secure proxy for the Notion OAuth token exchange, keeping your Client Secret off the client.

1. Go to [https://dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**
2. Paste the contents of `cloudflare-worker.js` into the editor and click **Deploy**
3. Go to **Settings → Variables** and add:
   - `NOTION_CLIENT_ID` — your Notion integration Client ID
   - `NOTION_CLIENT_SECRET` — your Notion integration Client Secret
4. Copy your Worker URL and paste it into `background.js` as `WORKER_URL`
5. Go back to your Notion integration and add the Worker URL as the **Redirect URI** — it should be the `chrome.identity` redirect URL, which looks like `https://<extension-id>.chromiumapp.org/`

---

### 4. Load the Extension in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select your project folder
4. Copy your **Extension ID** from the extensions page

---

### 5. First-Time Use (for you and your group)

1. Open the extension and click **View History**
2. Click **❓ How to Link Notion** for a step-by-step visual guide
3. Click **Login** and authorize with Notion
4. When prompted, enter your **Notion Database ID**
   - Create a new blank database in Notion first
   - Share it with your integration via the database's **Connections** settings
   - Copy the 32-character ID from the database URL (the part before `?v=`)
5. Click **Sync** — the extension will set up all required columns automatically

---

## Sharing with Your Group

Since this extension is not published on the Chrome Web Store, share it by:

1. Zipping the project folder and sending it to your colleagues
2. They load it via **Load unpacked** in `chrome://extensions` (same as step 4 above)
3. Each person logs in with their own Notion account and links their own database
4. No code changes are needed on their end — the Client ID and Worker URL are already in the code

---

## Notion Database Schema

The extension automatically creates these columns in your database on first sync:

| Column                               | Type   | Description                      |
| ------------------------------------ | ------ | -------------------------------- |
| Name _(or your language equivalent)_ | Title  | Paper title                      |
| URL                                  | URL    | Link to the paper                |
| Author / Source                      | Text   | Author and journal info          |
| Visit Count                          | Number | How many times you've visited    |
| First Visited                        | Date   | When you first clicked the paper |
| Last Visited                         | Date   | Most recent visit                |

---

## Privacy

- All data is stored locally in Chrome's `chrome.storage.local`
- Syncing only happens to **your own** Notion database
- The extension only activates on `scholar.google.com`
- No data is sent anywhere except the Notion API and your Cloudflare Worker

---

## Tech Stack

- **Chrome Extension** — Manifest V3, service worker, content script
- **Notion API** — REST API v2022-06-28
- **Cloudflare Workers** — Serverless OAuth proxy

---

## License

MIT License — free to use, modify, and distribute.
