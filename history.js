const loginStatus = document.getElementById("loginStatus");
const avatar = document.getElementById("avatar");

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const syncBtn = document.getElementById("syncBtn");

const lastSync = document.getElementById("lastSync");

/* ---------------- BUTTON LOADING ---------------- */

function setLoading(button, loading) {
  if (loading) {
    button.disabled = true;

    button.dataset.original = button.innerText;

    button.innerHTML = `${button.dataset.original} <span class="spinner"></span>`;
  } else {
    button.disabled = false;

    button.innerText = button.dataset.original;
  }
}

/* ---------------- LOGIN STATUS ---------------- */

async function checkLoginStatus() {
  const data = await chrome.storage.local.get(["notionToken", "notionUser"]);

  if (data.notionToken) {
    loginStatus.textContent = "Logged in to Notion";
    loginStatus.className = "logged-in";

    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";

    syncBtn.disabled = false;

    if (data.notionUser?.avatar_url) {
      avatar.src = data.notionUser.avatar_url;
      avatar.style.display = "block";
    }
  } else {
    loginStatus.textContent = "Not logged in";
    loginStatus.className = "logged-out";

    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";

    avatar.style.display = "none";

    syncBtn.disabled = true;
  }
}

/* ---------------- LAST SYNC ---------------- */

async function loadLastSync() {
  const data = await chrome.storage.local.get("lastSyncTime");

  if (data.lastSyncTime) {
    const formatted = new Date(data.lastSyncTime).toLocaleString();

    lastSync.textContent = "Last Sync: " + formatted;
  } else {
    lastSync.textContent = "Last Sync: Never";
  }
}

/* ---------------- LOGIN BUTTON ---------------- */

loginBtn.addEventListener("click", () => {
  setLoading(loginBtn, true);

  chrome.runtime.sendMessage({
    action: "login",
  });
});

/* ---------------- LOGOUT BUTTON ---------------- */

logoutBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(["notionToken", "notionUser"]);

  checkLoginStatus();
});

/* ---------------- SYNC BUTTON ---------------- */

syncBtn.addEventListener("click", async () => {
  setLoading(syncBtn, true);

  const local = await chrome.storage.local.get("visitedPapers");

  const localMap = local.visitedPapers || {};

  chrome.runtime.sendMessage({
    action: "bidirectionalSync",
    localCount: Object.keys(localMap).length,
  });
});

/* ---------------- BACKGROUND MESSAGES ---------------- */

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "loginSuccess") {
    setLoading(loginBtn, false);

    await checkLoginStatus();
  }

  if (msg.action === "loginFailed") {
    setLoading(loginBtn, false);

    alert("Notion login failed");
  }

  if (msg.action === "confirmImport") {
    const confirmImport = confirm(
      `Import ${msg.count} new papers from Notion?`,
    );

    chrome.runtime.sendMessage({
      action: "confirmImportResult",
      confirm: confirmImport,
    });
  }

  if (msg.action === "syncComplete") {
    setLoading(syncBtn, false);

    if (msg.cancelled) {
      // User declined the import — don't update lastSyncTime so next sync retries
      loadHistory();
      return;
    }

    const now = new Date().toISOString();

    await chrome.storage.local.set({
      lastSyncTime: now,
    });

    loadLastSync();

    if (msg.imported || msg.exported) {
      alert(
        `Sync complete\n` +
          `Exported or Updated: ${msg.exported}\n` +
          `Imported: ${msg.imported}`,
      );
    } else {
      alert("Already up to date");
    }

    loadHistory();
  }
});

/* ---------------- HISTORY TABLE ---------------- */

function loadHistory() {
  chrome.storage.local.get(["visitedPapers"], (data) => {
    const map = data.visitedPapers || {};

    const list = Object.values(map);

    const tbody = document.querySelector("#historyTable tbody");

    tbody.innerHTML = "";

    list.sort((a, b) => new Date(b.lastVisited) - new Date(a.lastVisited));

    list.forEach((item) => {
      const date = new Date(item.lastVisited).toLocaleString();

      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>
          <input type="checkbox"
          data-url="${encodeURIComponent(item.url)}">
        </td>

        <td>
          <a href="${item.url}" target="_blank">
          ${item.title || "(No title)"}
          </a>
        </td>

        <td>${item.authorInfo || ""}</td>

        <td>${item.visitCount || 1}</td>

        <td>${date}</td>
      `;

      tbody.appendChild(tr);
    });
  });
}

/* ---------------- DELETE SELECTED ---------------- */

document.getElementById("deleteSelected").addEventListener("click", () => {
  chrome.storage.local.get(["visitedPapers"], (data) => {
    const map = data.visitedPapers || {};

    const checkboxes = document.querySelectorAll(
      'input[type="checkbox"]:checked',
    );

    if (checkboxes.length === 0) {
      alert("Select at least one article.");

      return;
    }

    const confirmDelete = confirm(`Delete ${checkboxes.length} articles?`);

    if (!confirmDelete) return;

    checkboxes.forEach((cb) => {
      const url = decodeURIComponent(cb.dataset.url);

      delete map[url];
    });

    chrome.storage.local.set({ visitedPapers: map }, loadHistory);
  });
});

/* ---------------- CLEAR ALL ---------------- */

document.getElementById("clearAll").addEventListener("click", () => {
  chrome.storage.local.get(["visitedPapers"], (data) => {
    const count = Object.keys(data.visitedPapers || {}).length;

    if (count === 0) {
      alert("No articles to delete.");

      return;
    }

    const confirmClear = confirm(`Delete all ${count} articles?`);

    if (!confirmClear) return;

    chrome.storage.local.set({ visitedPapers: {} }, loadHistory);
  });
});

/* ---------------- LINK CLICK UPDATE ---------------- */

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[target='_blank']");

  if (!link) return;

  const url = link.getAttribute("href");

  if (!url) return;

  chrome.storage.local.get(["visitedPapers"], (data) => {
    const map = data.visitedPapers || {};

    if (map[url]) {
      map[url].lastVisited = new Date().toISOString();

      map[url].visitCount += 1;
    }

    chrome.storage.local.set({ visitedPapers: map }, loadHistory);
  });
});

/* ---------------- INIT ---------------- */

checkLoginStatus();
loadLastSync();
loadHistory();
