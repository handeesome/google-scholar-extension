// history.js

/* ---------------- UI ELEMENTS ---------------- */
const loginStatus = document.getElementById("loginStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const syncBtn = document.getElementById("syncBtn");
const lastSync = document.getElementById("lastSync");

/* ---------------- BUTTON LOADING FIX ---------------- */
function setLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    if (!button.dataset.original) {
      button.dataset.original = button.innerText;
    }
    button.innerHTML = `${button.dataset.original} <span class="spinner"></span>`;
  } else {
    button.disabled = false;
    button.innerText = button.dataset.original || button.innerText;
  }
}

/* ---------------- UI UPDATE & STATUS ---------------- */
async function refreshUI() {
  const data = await chrome.storage.local.get([
    "notionToken",
    "databaseId",
    "lastSyncTime",
  ]);

  if (data.notionToken && data.databaseId) {
    loginStatus.textContent = "Connected to Notion";
    loginStatus.className = "logged-in";
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    syncBtn.disabled = false;
  } else {
    loginStatus.textContent = "Not logged in";
    loginStatus.className = "logged-out";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    syncBtn.disabled = true;
  }

  if (data.lastSyncTime) {
    lastSync.textContent =
      "Last Sync: " + new Date(data.lastSyncTime).toLocaleString();
  }
}

/* ---------------- ACTION: SYNC (The "Everything" Button) ---------------- */
syncBtn.addEventListener("click", async () => {
  setLoading(syncBtn, true);

  // Get current local count to tell background.js if we need to "Import" (Restore)
  const data = await chrome.storage.local.get("visitedPapers");
  const localCount = Object.keys(data.visitedPapers || {}).length;

  // background.js bidirectionalSync handles:
  // 1. Pushing new local papers to Notion
  // 2. Pulling papers from Notion that are missing locally
  chrome.runtime.sendMessage({ action: "bidirectionalSync", localCount });
});

/* ---------------- ACTION: DELETE & CLEAR ---------------- */

// Delete Selected
document
  .getElementById("deleteSelected")
  .addEventListener("click", async () => {
    const checkboxes = document.querySelectorAll(
      '#historyTable tbody input[type="checkbox"]:checked',
    );
    if (checkboxes.length === 0) return;

    if (!confirm(`Delete ${checkboxes.length} selected items?`)) return;

    const data = await chrome.storage.local.get("visitedPapers");
    const visited = data.visitedPapers || {};

    checkboxes.forEach((cb) => {
      const url = decodeURIComponent(cb.dataset.url);
      // Notify background.js to delete from Notion
      chrome.runtime.sendMessage({ action: "deletePaper", url: url });
      delete visited[url];
    });

    await chrome.storage.local.set({ visitedPapers: visited });
    loadHistory();
  });

// Clear All
document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("Clear all local history? (This won't delete your Notion data)"))
    return;
  await chrome.storage.local.set({ visitedPapers: {} });
  loadHistory();
});

/* ---------------- AUTH LISTENERS ---------------- */
loginBtn.addEventListener("click", () => {
  setLoading(loginBtn, true);
  chrome.runtime.sendMessage({ action: "login" });
});

logoutBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "notionToken",
    "databaseId",
    "lastSyncTime",
  ]);
  refreshUI();
});

/* ---------------- MESSAGE HANDLER ---------------- */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "loginSuccess" || msg.action === "syncComplete") {
    setLoading(loginBtn, false);
    setLoading(syncBtn, false);
    refreshUI();
    if (msg.action === "syncComplete") loadHistory();
  }

  if (msg.action === "confirmImport") {
    // This happens if Sync finds papers in Notion you don't have locally
    if (
      confirm(
        `Found ${msg.count} papers in Notion. Import them to your local history?`,
      )
    ) {
      chrome.runtime.sendMessage({
        action: "confirmImportResult",
        confirm: true,
      });
    } else {
      chrome.runtime.sendMessage({
        action: "confirmImportResult",
        confirm: false,
      });
      setLoading(syncBtn, false);
    }
  }
});

/* ---------------- TABLE RENDERING ---------------- */
function loadHistory() {
  chrome.storage.local.get(["visitedPapers"], (data) => {
    const list = Object.values(data.visitedPapers || {});
    const tbody = document.querySelector("#historyTable tbody");
    tbody.innerHTML = "";

    list.sort((a, b) => new Date(b.lastVisited) - new Date(a.lastVisited));

    list.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-url="${encodeURIComponent(item.url)}"></td>
        <td><a href="${item.url}" target="_blank">${item.title || "Untitled"}</a></td>
        <td>${item.authorInfo || ""}</td>
        <td>${item.visitCount || 1}</td>
        <td>${new Date(item.lastVisited).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  });
}

/* ---------------- INITIALIZE ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  refreshUI();
  loadHistory();
});
