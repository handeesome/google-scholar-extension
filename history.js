// history.js

/* ---------------- UI ELEMENTS ---------------- */
const loginStatus = document.getElementById("loginStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const syncBtn = document.getElementById("syncBtn");
const lastSync = document.getElementById("lastSync");

/* ---------------- BUTTON LOADING ---------------- */
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

/* ---------------- ACTION: DELETE & CLEAR ---------------- */

// DELETE SELECTED: Removes from Local and Notion
document
  .getElementById("deleteSelected")
  .addEventListener("click", async () => {
    const checkboxes = document.querySelectorAll(
      '#historyTable tbody input[type="checkbox"]:checked',
    );
    if (checkboxes.length === 0) return;

    const confirmMsg =
      checkboxes.length === 1
        ? "Delete this paper from history and Notion?"
        : `Delete ${checkboxes.length} papers from history and Notion?`;

    if (!confirm(confirmMsg)) return;

    const data = await chrome.storage.local.get("visitedPapers");
    const visited = data.visitedPapers || {};

    checkboxes.forEach((cb) => {
      const url = decodeURIComponent(cb.dataset.url);

      // 1. Tell background.js to delete the page from Notion
      chrome.runtime.sendMessage({ action: "deletePaper", url: url });

      // 2. Remove from local storage map
      delete visited[url];
    });

    // 3. Save updated local storage
    await chrome.storage.local.set({ visitedPapers: visited });

    // 4. Refresh table
    loadHistory();
  });

// CLEAR ALL: Requires Logout first
document.getElementById("clearAll").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["notionToken"]);

  // Requirement: User must log out first
  if (data.notionToken) {
    alert(
      "Please Log Out from Notion before clearing all history to prevent data conflicts.",
    );
    return;
  }

  if (
    confirm(
      "Are you sure you want to clear ALL local history? This cannot be undone.",
    )
  ) {
    await chrome.storage.local.set({ visitedPapers: {} });
    loadHistory();
  }
});

/* ---------------- ACTION: SYNC ---------------- */
syncBtn.addEventListener("click", async () => {
  setLoading(syncBtn, true);
  const data = await chrome.storage.local.get("visitedPapers");
  const localCount = Object.keys(data.visitedPapers || {}).length;
  chrome.runtime.sendMessage({ action: "bidirectionalSync", localCount });
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
  // Handle Login Failure
  if (msg.action === "loginFailed") {
    setLoading(loginBtn, false); // Stop the spinner
    alert(
      "Login Failed: The authentication window was closed or the connection was interrupted.",
    );
    return;
  }

  // Existing Success/Sync handlers
  if (msg.action === "loginSuccess" || msg.action === "syncComplete") {
    setLoading(loginBtn, false);
    setLoading(syncBtn, false);
    refreshUI();
    if (msg.action === "syncComplete") loadHistory();
  }

  if (msg.action === "confirmImport") {
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

document.addEventListener("DOMContentLoaded", () => {
  refreshUI();
  loadHistory();
});
