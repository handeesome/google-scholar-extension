# 💡 Google Scholar Tracker

A Chrome extension for researchers who want to keep track of the academic papers they've read on Google Scholar — and sync everything to Notion automatically.

---

## Why I Built This

If you do a lot of literature reviews, you've probably opened the same paper twice without realizing it. This extension highlights papers you've already visited directly in your Google Scholar search results, so you always know what you've read, how many times, and when.

---

## What It Does

- **Highlights visited papers** on Google Scholar search results.
- **Shows visit count and last visited date** inline next to each result.
- **Tracks automatically** — no buttons to click, just browse Scholar as usual.
- **Syncs to Notion** — every paper you click is pushed to your database in the background.
- **Zero Configuration** — the extension automatically finds your database and sets up the columns.

---

## How to Install

This extension is not on the Chrome Web Store, so you'll need to load it manually:

1. Download or clone this repository.
2. Go to `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the project folder.

---

## How to Link to Notion

Setting up the sync is now entirely automated. You don't need to copy-paste any IDs.

### 1. Log In

Click **Login** in the extension history page. This will open the secure Notion authorization window.

### 2. Choose Your Database

You will be asked to select which pages or databases the extension can access. You have two options:

- **Option A: Use the Template (Recommended)**
  Choose to **"Duplicate Template"** if prompted. The extension will automatically find this new database and link to it.
- **Option B: Use Your Own Database**
  Search for and select an existing database in your workspace.
  _Note: Please ensure you select the **Database** itself, rather than just the parent Page it lives on._

### 3. Automatic Setup

After you click **Allow Access**, the window will close and the extension will handle the rest:

- It searches your authorized pages for the database.
- It automatically creates the required columns (`Visit Count`, `URL`, `Last Visited`, etc.) if they are missing.
- It saves your connection settings instantly.

### 4. Sync

Click **Sync** — your history will appear in Notion. From now on, any paper you click on Google Scholar will sync to Notion in real-time.

---

## Notion Database Columns

The extension manages these columns for you:

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

The client secret is protected by a Cloudflare Worker proxy. To self-host:

1. Create a [Notion integration](https://www.notion.so/my-integrations) (Public integration).
2. Deploy `cloudflare-worker.js` to Cloudflare Workers with `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` environment variables.
3. Update `WORKER_URL` in `background.js`.

---

## License

MIT — free to use and modify.
