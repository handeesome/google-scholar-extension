# 💡 Google Scholar Tracker

A Chrome extension for researchers who want to keep track of the academic papers they've read on Google Scholar — and sync everything to Notion automatically.

---

## Why I Built This

If you do a lot of literature reviews, you've probably opened the same paper twice without realizing it. This extension solves that by highlighting papers you've already visited directly in your Google Scholar search results, so you always know what you've read, how many times, and when.

---

## What It Does

- **Highlights visited papers** on Google Scholar search results — yellow for papers visited fewer than 5 times, red for 5 or more
- **Shows visit count and last visited date** inline next to each result
- **Tracks automatically** — no buttons to click, just browse Scholar as usual
- **Syncs to your Notion database** — every paper you click is pushed to Notion in the background
- **Bidirectional sync** — pull papers from Notion back into the extension too
- **Full history page** — browse and delete your visited papers in one place
- **Works for a group** — each user connects their own Notion database, so everyone tracks independently

---

## How to Install

This extension is not on the Chrome Web Store, so you'll need to load it manually:

1. Download or clone this repository
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the project folder
5. The extension icon will appear in your toolbar

---

## How to Link to Notion

Click the **❓ How to Link Notion** button in the History page for a visual step-by-step guide. Here's a summary:

### 1. Create a Notion database

Create a new page in Notion and add a **Database** to it. Choose **Empty database**.

### 2. Share it with the integration

Open your database → click `•••` in the top right → **Connections** → search for **Google Scholar Tracker** and connect it.

### 3. Log in

Click **Login** in the History page and authorize with your Notion account.

### 4. Enter your Database ID

When prompted, paste your Database ID. You can find it in your database's URL:

```
notion.so/your-name/[DATABASE_ID]?v=...
```

It's the 32-character string before the `?v=`. The extension will automatically set up all required columns on first sync.

### 5. Sync

Click **Sync** — your visited papers will appear in your Notion database. From now on, papers are pushed to Notion automatically every time you click one on Google Scholar.

---

## Notion Database Columns

The extension creates these columns automatically on first sync:

| Column          | Type   |
| --------------- | ------ |
| Name            | Title  |
| URL             | URL    |
| Author / Source | Text   |
| Visit Count     | Number |
| First Visited   | Date   |
| Last Visited    | Date   |

---

## For Developers

The client secret is not stored in this repository. It lives in a Cloudflare Worker that proxies the Notion OAuth token exchange. To self-host:

1. Create a [Notion integration](https://www.notion.so/my-integrations) and copy the Client ID and Client Secret
2. Deploy `cloudflare-worker.js` to Cloudflare Workers and add `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` as environment variables
3. Set `CLIENT_ID` and `WORKER_URL` at the top of `background.js`

---

## Tech Stack

- Chrome Extension (Manifest V3)
- Notion API (REST, v2022-06-28)
- Cloudflare Workers (OAuth proxy)

---

## License

MIT — free to use and modify.
