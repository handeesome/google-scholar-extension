const CLIENT_ID = "30fd872b-594c-81ed-90e7-0037c6455a92";
const WORKER_URL = "https://notion-auth.ducenhandee.workers.dev";

const NOTION_VERSION = "2022-06-28";

let pendingImport = [];
let pendingExported = 0;

let syncQueue = [];
let queueRunning = false;

let schemaChecked = false;
let titlePropertyName = "Name";
let lastKnownDatabaseId = null;

/* ---------------- MESSAGE LISTENER ---------------- */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "login") loginToNotion();

  if (msg.action === "bidirectionalSync") bidirectionalSync(msg.localCount);

  if (msg.action === "confirmImportResult")
    handleImportConfirmation(msg.confirm);

  if (msg.action === "paperVisited") queueSync(msg.paper);

  if (msg.action === "deletePaper") deleteNotionPage(msg.url);
});

/* ---------------- DATABASE SCHEMA CHECK ---------------- */

async function ensureDatabaseSchema(token, databaseId) {
  // Reset if database has changed
  if (databaseId !== lastKnownDatabaseId) {
    schemaChecked = false;
    titlePropertyName = "Name";
  }
  if (schemaChecked) return;

  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
  });

  const db = await res.json();

  if (!res.ok || !db.properties) {
    console.error(
      "Failed to fetch database schema:",
      JSON.stringify(db, null, 2),
    );
    schemaChecked = false;
    const msg =
      db.status === 404
        ? "Database not found. Please check your Database ID."
        : db.status === 403
          ? "Access denied. Share the Notion database with your integration first."
          : `Database error: ${db.message || "Unknown error"}`;
    chrome.runtime.sendMessage({ action: "syncError", message: msg });
    throw new Error("Database fetch failed");
  }

  const existing = db.properties;

  // Find the title property — name varies by Notion language (e.g. "名称", "标题")
  let existingTitleKey = null;
  for (const [key, val] of Object.entries(existing)) {
    if (val.type === "title") {
      existingTitleKey = key;
      break;
    }
  }

  const required = {
    URL: { url: {} },
    "Author / Source": { rich_text: {} },
    "Visit Count": { number: {} },
    "First Visited": { date: {} },
    "Last Visited": { date: {} },
  };

  // Use the detected title key directly — no rename needed
  if (!existingTitleKey) {
    console.error(
      "Could not find title property in database. Properties found:",
      Object.keys(existing),
    );
  }
  titlePropertyName = existingTitleKey || Object.keys(existing)[0];
  console.log(
    `Using title property: "${titlePropertyName}". All properties:`,
    Object.keys(existing),
  );

  // Add any missing non-title properties
  const missing = {};
  for (const key in required) {
    if (!existing[key]) {
      missing[key] = required[key];
    }
  }

  if (Object.keys(missing).length > 0) {
    const updateRes = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify({ properties: missing }),
      },
    );

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error(
        "Schema update failed:",
        JSON.stringify(updateData, null, 2),
      );
    } else {
      console.log("Missing columns added successfully");
    }
  }

  lastKnownDatabaseId = databaseId;
  schemaChecked = true;
}

/* ---------------- SYNC QUEUE ---------------- */

function queueSync(paper) {
  if (!paper) return;

  syncQueue.push(paper);

  if (!queueRunning) processQueue();
}

async function processQueue() {
  queueRunning = true;

  while (syncQueue.length > 0) {
    const paper = syncQueue.shift();

    try {
      await autoSync(paper);
    } catch (e) {
      console.error("Queue sync error", e);
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  queueRunning = false;
}

/* ---------------- AUTO SYNC ---------------- */

async function autoSync(paper) {
  const { notionToken, databaseId } = await chrome.storage.local.get([
    "notionToken",
    "databaseId",
  ]);

  if (!notionToken || !paper || !databaseId) return;

  await ensureDatabaseSchema(notionToken, databaseId);

  try {
    if (!paper.notionPageId) {
      const id = await createPage(notionToken, databaseId, paper);
      const storage = await chrome.storage.local.get("visitedPapers");
      const map = storage.visitedPapers || {};
      if (map[paper.url]) {
        map[paper.url].notionPageId = id;
        await chrome.storage.local.set({ visitedPapers: map });
      }
    } else {
      const updated = await updatePage(notionToken, paper);
      if (!updated) {
        // Stale/archived page — clear ID and recreate
        const storage = await chrome.storage.local.get("visitedPapers");
        const map = storage.visitedPapers || {};
        if (map[paper.url]) {
          map[paper.url].notionPageId = null;
          const id = await createPage(notionToken, databaseId, map[paper.url]);
          if (id) map[paper.url].notionPageId = id;
          await chrome.storage.local.set({ visitedPapers: map });
        }
      }
    }

    // Update lastSyncTime so manual sync doesn't re-export auto-synced papers
    await chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
  } catch (e) {
    console.error("Auto sync failed", e);
  }
}

/* ---------------- DELETE PAGE ---------------- */

async function deleteNotionPage(url) {
  const storage = await chrome.storage.local.get([
    "notionToken",
    "visitedPapers",
  ]);

  const paper = storage.visitedPapers?.[url];

  if (!paper || !paper.notionPageId) return;

  await fetch(`https://api.notion.com/v1/pages/${paper.notionPageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${storage.notionToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      archived: true,
    }),
  });
}

/* ---------------- LOGIN ---------------- */

async function loginToNotion() {
  const redirectUri = chrome.identity.getRedirectURL();

  const authUrl =
    `https://api.notion.com/v1/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&owner=user` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  const winWidth = 600;
  const winHeight = 700;

  // As soon as the auth popup is created, reposition it to center
  function onWindowCreated(win) {
    if (win.type !== "popup") return;
    chrome.windows.onCreated.removeListener(onWindowCreated);

    chrome.system.display.getInfo((displays) => {
      const primary =
        (displays && displays.find((d) => d.isPrimary)) || displays?.[0];
      const screenW = primary?.bounds?.width || 1280;
      const screenH = primary?.bounds?.height || 800;
      const screenL = primary?.bounds?.left || 0;
      const screenT = primary?.bounds?.top || 0;

      chrome.windows.update(win.id, {
        left: screenL + Math.round((screenW - winWidth) / 2),
        top: screenT + Math.round((screenH - winHeight) / 2),
        width: winWidth,
        height: winHeight,
      });
    });
  }

  chrome.windows.onCreated.addListener(onWindowCreated);

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    async (redirectedTo) => {
      chrome.windows.onCreated.removeListener(onWindowCreated);

      if (!redirectedTo || chrome.runtime.lastError) {
        chrome.runtime.sendMessage({ action: "loginFailed" });
        console.log("Auth flow error:", chrome.runtime.lastError);
        return;
      }

      const code = new URL(redirectedTo).searchParams.get("code");

      if (!code) {
        chrome.runtime.sendMessage({ action: "loginFailed" });
        console.log("No code found in redirect URL:", redirectedTo);
        return;
      }

      // Exchange code via Cloudflare Worker (keeps Client Secret off the client)
      const tokenResponse = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
      });

      const tokenData = await tokenResponse.json();
      const token = tokenData.access_token;

      if (!token) {
        chrome.runtime.sendMessage({ action: "loginFailed" });
        console.log(
          "Token exchange failed:",
          JSON.stringify(tokenData, null, 2),
        );
        return;
      }

      const userRes = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
        },
      });

      const userData = await userRes.json();

      await chrome.storage.local.set({
        notionToken: token,
        notionUser: userData,
      });

      // Auto-detect the database the user granted access to
      const databaseId = await detectGrantedDatabase(token);

      if (databaseId) {
        await chrome.storage.local.set({ databaseId });
        chrome.runtime.sendMessage({ action: "loginSuccess", databaseId });
      } else {
        // Fallback: couldn't auto-detect, ask user manually
        chrome.runtime.sendMessage({
          action: "loginSuccess",
          databaseId: null,
        });
      }
    },
  );
}

/* ---------------- AUTO DETECT DATABASE ---------------- */

async function detectGrantedDatabase(token) {
  try {
    // Search for all databases the integration has access to
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        filter: { value: "database", property: "object" },
        page_size: 10,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.results?.length) {
      console.warn("No databases found after OAuth:", data);
      return null;
    }

    if (data.results.length === 1) {
      // Exactly one database — use it automatically
      const db = data.results[0];
      console.log("Auto-detected database:", db.id, db.title?.[0]?.plain_text);
      return db.id.replace(/-/g, "");
    }

    // Multiple databases — pick the most recently edited one
    // (most likely the one they just created or connected)
    const sorted = data.results.sort(
      (a, b) => new Date(b.last_edited_time) - new Date(a.last_edited_time),
    );
    const db = sorted[0];
    console.log("Multiple databases found, using most recent:", db.id);
    return db.id.replace(/-/g, "");
  } catch (e) {
    console.error("detectGrantedDatabase failed:", e);
    return null;
  }
}

/* ---------------- DATABASE QUERY ---------------- */

async function queryDatabaseIncremental(token, databaseId) {
  await ensureDatabaseSchema(token, databaseId);

  const { lastSyncTime } = await chrome.storage.local.get("lastSyncTime");

  let results = [];
  let cursor;

  while (true) {
    const body = { start_cursor: cursor };

    if (lastSyncTime) {
      body.filter = {
        timestamp: "last_edited_time",
        last_edited_time: { after: lastSyncTime },
      };
    }

    const res = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify(body),
      },
    );

    const data = await res.json();

    results.push(...data.results);

    if (!data.has_more) break;

    cursor = data.next_cursor;
  }

  return results;
}

/* ---------------- PAGE PARSER ---------------- */

function notionPageToPaper(page) {
  const props = page.properties;

  return {
    notionPageId: page.id,
    url: props.URL?.url || "",
    title: props[titlePropertyName]?.title?.[0]?.plain_text || "",
    authorInfo: props["Author / Source"]?.rich_text?.[0]?.plain_text || "",
    visitCount: props["Visit Count"]?.number || 1,
    firstVisited: props["First Visited"]?.date?.start || null,
    lastVisited: props["Last Visited"]?.date?.start || null,
  };
}

/* ---------------- CREATE PAGE ---------------- */

async function createPage(token, databaseId, paper) {
  // Safety: if titlePropertyName is stale, force schema re-check
  if (!titlePropertyName || titlePropertyName === "Name") {
    schemaChecked = false;
    await ensureDatabaseSchema(token, databaseId);
  }

  const now = new Date().toISOString();
  const title = paper.title?.trim() || "(No title)";
  const firstVisited = paper.firstVisited || now;
  const lastVisited = paper.lastVisited || now;
  const visitCount = paper.visitCount || 1;

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        [titlePropertyName]: {
          title: [{ text: { content: title } }],
        },
        URL: { url: paper.url },
        "Author / Source": {
          rich_text: [{ text: { content: paper.authorInfo || "" } }],
        },
        "Visit Count": { number: visitCount },
        "First Visited": { date: { start: firstVisited } },
        "Last Visited": { date: { start: lastVisited } },
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Notion create error:", JSON.stringify(data, null, 2));
    console.error("Paper that failed:", JSON.stringify(paper, null, 2));
    return null;
  }

  return data.id;
}

/* ---------------- UPDATE PAGE ---------------- */

async function updatePage(token, paper) {
  const now = new Date().toISOString();

  const res = await fetch(
    `https://api.notion.com/v1/pages/${paper.notionPageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        properties: {
          "Visit Count": { number: paper.visitCount || 1 },
          "Last Visited": { date: { start: paper.lastVisited || now } },
        },
      }),
    },
  );

  if (!res.ok) {
    const data = await res.json();
    console.error("Notion update failed:", JSON.stringify(data, null, 2));
    return false;
  }

  return true;
}

/* ---------------- BIDIRECTIONAL SYNC ---------------- */

async function bidirectionalSync(localCount) {
  const storage = await chrome.storage.local.get([
    "notionToken",
    "visitedPapers",
    "lastSyncTime",
    "databaseId",
  ]);

  const token = storage.notionToken;

  if (!token) {
    chrome.runtime.sendMessage({
      action: "syncComplete",
      exported: 0,
      imported: 0,
    });

    return;
  }

  const databaseId = storage.databaseId;

  if (!databaseId) {
    chrome.runtime.sendMessage({ action: "noDatabaseId" });
    return;
  }

  await ensureDatabaseSchema(token, databaseId);

  const lastSyncTime = storage.lastSyncTime;
  const localMap = storage.visitedPapers || {};

  const notionPages = await queryDatabaseIncremental(token, databaseId);
  const remotePapers = notionPages.map(notionPageToPaper);

  const localUrls = new Set(Object.keys(localMap));

  let exported = 0;

  for (const url of Object.keys(localMap)) {
    const paper = localMap[url];

    const changed =
      !lastSyncTime ||
      (paper.lastVisited &&
        new Date(paper.lastVisited) > new Date(lastSyncTime));

    if (!changed) continue;

    if (paper.notionPageId) {
      const updated = await updatePage(token, paper);
      if (!updated) {
        // Stale/archived page from old database — clear ID and recreate
        localMap[url].notionPageId = null;
        const pageId = await createPage(token, databaseId, localMap[url]);
        if (pageId) localMap[url].notionPageId = pageId;
      }
    } else {
      const pageId = await createPage(token, databaseId, paper);
      if (pageId) localMap[url].notionPageId = pageId;
    }

    exported++;
  }

  let importList = [];

  for (const paper of remotePapers) {
    if (!localUrls.has(paper.url)) {
      importList.push(paper);
    }
  }

  await chrome.storage.local.set({ visitedPapers: localMap });

  if (importList.length === 0) {
    finishSync(exported, 0);

    return;
  }

  if (localCount === 0) {
    await performImport(importList);

    finishSync(exported, importList.length);

    return;
  }

  pendingImport = importList;
  pendingExported = exported;

  chrome.runtime.sendMessage({
    action: "confirmImport",
    count: importList.length,
  });
}

/* ---------------- IMPORT HANDLING ---------------- */

async function handleImportConfirmation(confirm) {
  if (!confirm) {
    // Don't update lastSyncTime — user cancelled, so next sync should retry
    chrome.runtime.sendMessage({
      action: "syncComplete",
      exported: pendingExported,
      imported: 0,
      cancelled: true,
    });

    pendingImport = [];
    pendingExported = 0;

    return;
  }

  await performImport(pendingImport);

  finishSync(pendingExported, pendingImport.length);

  pendingImport = [];
  pendingExported = 0;
}

async function performImport(importList) {
  const storage = await chrome.storage.local.get("visitedPapers");

  const map = storage.visitedPapers || {};

  for (const paper of importList) {
    map[paper.url] = paper;
  }

  await chrome.storage.local.set({ visitedPapers: map });
}

/* ---------------- SYNC COMPLETE ---------------- */

function finishSync(exported, imported) {
  chrome.storage.local.set({
    lastSyncTime: new Date().toISOString(),
  });

  chrome.runtime.sendMessage({
    action: "syncComplete",
    exported,
    imported,
  });
}
