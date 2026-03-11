const paperCountEl = document.getElementById("paperCount");
const lastPaperTitleEl = document.getElementById("lastPaperTitle");
const lastPaperTimeEl = document.getElementById("lastPaperTime");
const lastPaperCard = document.getElementById("lastPaperCard");
let lastPaperUrl = null;
const openHistoryBtn = document.getElementById("openHistory");

function loadStats() {
  chrome.storage.local.get(["visitedPapers"], (data) => {
    const papers = data.visitedPapers || {};
    const list = Object.values(papers);

    paperCountEl.textContent = list.length;

    if (list.length === 0) {
      lastPaperTitleEl.textContent = "None yet";
      lastPaperTimeEl.textContent = "";
      return;
    }

    list.sort((a, b) => new Date(b.lastVisited) - new Date(a.lastVisited));

    const latest = list[0];

    lastPaperTitleEl.textContent = latest.title || "Untitled Paper";

    const formatted = new Date(latest.lastVisited).toLocaleString();
    lastPaperTimeEl.textContent = formatted;

    lastPaperUrl = latest.url;
    lastPaperCard.addEventListener("click", () => {
      if (!lastPaperUrl) return;

      chrome.tabs.create({
        url: lastPaperUrl,
      });
    });
  });
}

openHistoryBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("history.html"),
  });
});

loadStats();
