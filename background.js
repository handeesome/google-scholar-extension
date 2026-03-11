const CLIENT_ID = "30fd872b-594c-81ed-90e7-0037c6455a92";
const CLIENT_SECRET = "REMOVED";

const DATABASE_ID = "30f1ed958a9980d3ab76cce757b541d4";
const NOTION_VERSION = "2022-06-28";

let pendingImport = [];

let syncQueue = [];
let queueRunning = false;

let schemaChecked = false;

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

async function ensureDatabaseSchema(token) {
  if (schemaChecked) return;

  const res = await fetch(
    `https://api.notion.com/v1/databases/${DATABASE_ID}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
    },
  );

  const db = await res.json();

  const existing = db.properties;

  const required = {
    URL: { url: {} },
    "Author / Source": { rich_text: {} },
    "Visit Count": { number: {} },
    "First Visited": { date: {} },
    "Last Visited": { date: {} },
  };

  const missing = {};

  for (const key in required) {
    if (!existing[key]) {
      missing[key] = required[key];
    }
  }

  if (Object.keys(missing).length > 0) {
    console.log("Adding missing Notion properties:", missing);

    const updateRes = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": NOTION_VERSION,
        },
        body: JSON.stringify({
          properties: missing,
        }),
      },
    );

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
      console.error("Schema update failed", updateData);
    }
  }

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
  const { notionToken } = await chrome.storage.local.get("notionToken");

  if (!notionToken || !paper) return;

  await ensureDatabaseSchema(notionToken);

  try {
    if (!paper.notionPageId) {
      const id = await createPage(notionToken, paper);

      const storage = await chrome.storage.local.get("visitedPapers");
      const map = storage.visitedPapers || {};

      if (map[paper.url]) {
        map[paper.url].notionPageId = id;

        await chrome.storage.local.set({ visitedPapers: map });
      }
    } else {
      await updatePage(notionToken, paper);
    }
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

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    async (redirectedTo) => {
      if (!redirectedTo) return;

      const code = new URL(redirectedTo).searchParams.get("code");

      const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

      const tokenResponse = await fetch(
        "https://api.notion.com/v1/oauth/token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION,
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        },
      );

      const tokenData = await tokenResponse.json();
      const token = tokenData.access_token;

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

      chrome.runtime.sendMessage({ action: "loginSuccess" });
    },
  );
}

/* ---------------- DATABASE QUERY ---------------- */

async function queryDatabaseIncremental(token) {
  await ensureDatabaseSchema(token);

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
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
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
    title: props.Name?.title?.[0]?.plain_text || "",
    authorInfo: props["Author / Source"]?.rich_text?.[0]?.plain_text || "",
    visitCount: props["Visit Count"]?.number || 1,
    firstVisited: props["First Visited"]?.date?.start || null,
    lastVisited: props["Last Visited"]?.date?.start || null,
  };
}

/* ---------------- CREATE PAGE ---------------- */

async function createPage(token, paper) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: DATABASE_ID },
      properties: {
        Name: {
          title: [{ text: { content: paper.title } }],
        },
        URL: { url: paper.url },
        "Author / Source": {
          rich_text: [{ text: { content: paper.authorInfo || "" } }],
        },
        "Visit Count": { number: paper.visitCount },
        "First Visited": { date: { start: paper.firstVisited } },
        "Last Visited": { date: { start: paper.lastVisited } },
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Notion create error", data);
    return null;
  }

  return data.id;
}

/* ---------------- UPDATE PAGE ---------------- */

async function updatePage(token, paper) {
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
          "Visit Count": { number: paper.visitCount },
          "Last Visited": { date: { start: paper.lastVisited } },
        },
      }),
    },
  );

  if (!res.ok) {
    console.error("Notion update failed", await res.json());
  }
}

/* ---------------- BIDIRECTIONAL SYNC ---------------- */

async function bidirectionalSync(localCount) {
  const storage = await chrome.storage.local.get([
    "notionToken",
    "visitedPapers",
    "lastSyncTime",
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

  await ensureDatabaseSchema(token);

  const lastSyncTime = storage.lastSyncTime;
  const localMap = storage.visitedPapers || {};

  const notionPages = await queryDatabaseIncremental(token);
  const remotePapers = notionPages.map(notionPageToPaper);

  const localUrls = new Set(Object.keys(localMap));

  let exported = 0;

  for (const paper of Object.values(localMap)) {
    const changed =
      !lastSyncTime ||
      (paper.lastVisited &&
        new Date(paper.lastVisited) > new Date(lastSyncTime));

    if (!changed) continue;

    if (paper.notionPageId) {
      await updatePage(token, paper);
    } else {
      const pageId = await createPage(token, paper);

      if (pageId) {
        paper.notionPageId = pageId;
      }
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

  chrome.runtime.sendMessage({
    action: "confirmImport",
    count: importList.length,
  });
}

/* ---------------- IMPORT HANDLING ---------------- */

async function handleImportConfirmation(confirm) {
  if (!confirm) {
    finishSync(0, 0);

    return;
  }

  await performImport(pendingImport);

  finishSync(0, pendingImport.length);

  pendingImport = [];
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
