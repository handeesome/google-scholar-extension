// content.js

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function applyHighlight(link, record) {
  const { visitCount, lastVisited } = record;

  link.style.backgroundColor = visitCount >= 5 ? "#ffcdd2" : "#fff3cd";
  link.style.border = "2px solid #ff9800";
  link.style.padding = "2px 4px";
  link.style.borderRadius = "4px";
  link.style.fontWeight = "bold";

  if (!link.parentElement.querySelector(".visited-badge")) {
    const badge = document.createElement("span");

    const formattedDate = new Date(lastVisited).toLocaleString();

    badge.textContent = `✔ Visited ${visitCount} time(s) | Last: ${formattedDate}`;
    badge.className = "visited-badge";
    badge.style.color = "#d32f2f";
    badge.style.fontWeight = "600";
    badge.style.marginLeft = "6px";
    badge.style.fontSize = "0.9em";

    link.insertAdjacentElement("afterend", badge);
  }
}

function processPage(visitedMap) {
  document.querySelectorAll(".gs_ri").forEach((card) => {
    const linkEl = card.querySelector(".gs_rt a");
    if (!linkEl) return;

    const key = normalizeUrl(linkEl.href);
    const record = visitedMap[key];

    if (record) {
      applyHighlight(linkEl, record);
    }

    // Prevent duplicate listeners
    if (!linkEl.dataset.listenerAttached) {
      linkEl.dataset.listenerAttached = "true";

      linkEl.addEventListener("click", () => {
        const title = linkEl.innerText.trim();
        const authorInfo = card.querySelector(".gs_a")?.innerText.trim() || "";
        chrome.storage.local.get(["visitedPapers"], (res) => {
          const visited = res.visitedPapers || {};
          const now = new Date().toISOString();

          if (!visited[key]) {
            visited[key] = {
              title,
              url: key,
              authorInfo,
              firstVisited: now,
              lastVisited: now,
              visitCount: 1,
            };
          } else {
            visited[key].visitCount += 1;
            visited[key].lastVisited = now;
          }

          chrome.storage.local.set({ visitedPapers: visited });
          applyHighlight(linkEl, visited[key]);
        });
      });
    }
  });
}

function init() {
  function refresh() {
    chrome.storage.local.get(["visitedPapers"], (data) => {
      const visited = data.visitedPapers || {};
      processPage(visited);
    });
  }

  refresh();

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.addedNodes.length > 0)) {
      refresh();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

init();
