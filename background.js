const CLIENT_ID = "30fd872b-594c-81ed-90e7-0037c6455a92";
const CLIENT_SECRET = "REMOVED";

const DATABASE_ID = "30f1ed958a9980d3ab76cce757b541d4";

const NOTION_VERSION = "2022-06-28";

let pendingImport = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "login") loginToNotion();

  if (msg.action === "bidirectionalSync") bidirectionalSync(msg.localCount);

  if (msg.action === "confirmImportResult")
    handleImportConfirmation(msg.confirm);
});

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

      chrome.runtime.sendMessage({
        action: "loginSuccess",
      });
    },
  );
}

async function queryDatabaseIncremental(token) {
  const { lastSyncTime } = await chrome.storage.local.get("lastSyncTime");

  let results = [];
  let cursor = undefined;

  while (true) {
    const body = {
      start_cursor: cursor,
    };

    if (lastSyncTime) {
      body.filter = {
        property: "Last Visited",
        date: { after: lastSyncTime },
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

function notionPageToPaper(page) {
  const props = page.properties;

  return {
    url: props.URL?.url || "",
    title: props.Name?.title?.[0]?.plain_text || "",
    visitCount: props["Visit Count"]?.number || 1,
    firstVisited: props["First Visited"]?.date?.start || null,
    lastVisited: props["Last Visited"]?.date?.start || null,
  };
}

async function createPage(token, paper) {
  await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: {
        database_id: DATABASE_ID,
      },

      properties: {
        Name: {
          title: [
            {
              text: { content: paper.title },
            },
          ],
        },

        URL: {
          url: paper.url,
        },

        "Visit Count": {
          number: paper.visitCount,
        },

        "First Visited": {
          date: { start: paper.firstVisited },
        },

        "Last Visited": {
          date: { start: paper.lastVisited },
        },
      },
    }),
  });
}

async function bidirectionalSync(localCount) {
  const storage = await chrome.storage.local.get([
    "notionToken",
    "visitedPapers",
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

  const localMap = storage.visitedPapers || {};

  const notionPages = await queryDatabaseIncremental(token);
  const remotePapers = notionPages.map(notionPageToPaper);

  const localUrls = new Set(Object.keys(localMap));

  const remoteUrls = new Set(remotePapers.map((p) => p.url));

  let exportList = [];
  let importList = [];

  for (const paper of Object.values(localMap)) {
    if (!remoteUrls.has(paper.url)) {
      exportList.push(paper);
    }
  }

  for (const paper of remotePapers) {
    if (!localUrls.has(paper.url)) {
      importList.push(paper);
    }
  }

  for (const paper of exportList) {
    await createPage(token, paper);
  }

  if (importList.length === 0) {
    finishSync(exportList.length, 0);

    return;
  }

  if (localCount === 0) {
    await performImport(importList);

    finishSync(exportList.length, importList.length);

    return;
  }

  pendingImport = importList;

  chrome.runtime.sendMessage({
    action: "confirmImport",
    count: importList.length,
  });
}

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

  await chrome.storage.local.set({
    visitedPapers: map,
  });
}

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
