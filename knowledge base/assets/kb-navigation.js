(() => {
  const storageKey = "superhostem-kb-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let tocObserver = null;
  let shortcutBound = false;
  const articleTextCache = new Map();

  const normalize = (value, locale) =>
    (value || "")
      .toLocaleLowerCase(locale || document.documentElement.lang || "en")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const applyTheme = (preference) => {
    const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved === "dark" ? "dark" : "light";
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === preference;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };

  const bindThemeToggle = () => {
    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      if (button.dataset.kbThemeBound === "true") return;
      button.dataset.kbThemeBound = "true";
      button.addEventListener("click", () => {
        localStorage.setItem(storageKey, button.dataset.themeOption);
        applyTheme(button.dataset.themeOption);
      });
    });
  };

  const slugify = (value, locale) =>
    value
      .toLocaleLowerCase(locale || document.documentElement.lang || "en")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "sekce";

  const bindArticleToc = () => {
    const toc = document.querySelector("#kb-article-toc");
    const sidebar = document.querySelector("#kb-article-sidebar");
    const content = document.querySelector("#kb-article-content");
    if (!toc || !sidebar || !content) return;

    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }

    const headings = [...content.querySelectorAll("h2")];
    const usedIds = new Set();

    headings.forEach((heading) => {
      let base = heading.id ? slugify(heading.id) : slugify(heading.textContent || "sekce");
      let id = base;
      let i = 2;
      while (usedIds.has(id) || (document.getElementById(id) && document.getElementById(id) !== heading)) {
        id = `${base}-${i}`;
        i += 1;
      }
      heading.id = id;
      usedIds.add(id);
    });

    if (headings.length < 2) {
      sidebar.hidden = true;
      toc.innerHTML = "";
      return;
    }

    sidebar.hidden = false;
    toc.innerHTML = headings
      .map((heading) => `<a href="#${heading.id}">${heading.textContent.trim()}</a>`)
      .join("");

    const tocLinks = [...toc.querySelectorAll("a")];
    tocObserver = new IntersectionObserver(
      (entries) => {
        const active = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!active) return;
        tocLinks.forEach((link) => {
          link.classList.toggle("is-active", link.getAttribute("href") === `#${active.target.id}`);
        });
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    headings.forEach((heading) => tocObserver.observe(heading));
  };

  const bindSearch = () => {
    const searchInput = document.querySelector("#kb-search-input");
    if (!searchInput) return;
    const searchableCards = [...document.querySelectorAll("[data-search-text]")];
    const emptyState = document.querySelector(".kb-empty-state");
    const searchableSections = [...document.querySelectorAll(".kb-help-section")];
    const loadingState = { active: false };

    const getCardLinks = (card) =>
      [...card.querySelectorAll("a[href$='.html']")]
        .map((link) => new URL(link.getAttribute("href"), window.location.href).href);

    const fetchArticleText = async (url) => {
      if (articleTextCache.has(url)) return articleTextCache.get(url);

      const promise = fetch(url, { headers: { "X-Requested-With": "kb-search-index" } })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const title = doc.querySelector(".kb-article-title, title")?.textContent || "";
          const lead = doc.querySelector(".kb-article-lead")?.textContent || "";
          const body = doc.querySelector("#kb-article-content")?.textContent || "";
          return normalize(`${title} ${lead} ${body}`);
        })
        .catch(() => "");

      articleTextCache.set(url, promise);
      return promise;
    };

    const enrichCardsWithArticleText = async () => {
      const cardsToLoad = searchableCards.filter((card) => card.dataset.kbIndexed !== "true");
      await Promise.all(
        cardsToLoad.map(async (card) => {
          const urls = [...new Set(getCardLinks(card))];
          if (urls.length === 0) {
            card.dataset.kbIndexed = "true";
            return;
          }

          const articleTexts = await Promise.all(urls.map((url) => fetchArticleText(url)));
          card.dataset.kbArticleText = articleTexts.filter(Boolean).join(" ");
          card.dataset.kbIndexed = "true";
        })
      );
    };

    const applySearch = () => {
      const query = normalize(searchInput.value.trim());
      let visibleCount = 0;

      searchableCards.forEach((card) => {
        const haystack = normalize(
          `${card.textContent || ""} ${card.dataset.searchText || ""} ${card.dataset.kbArticleText || ""}`
        );
        const match = !query || haystack.includes(query);
        card.hidden = !match;
        if (match) visibleCount += 1;
      });

      searchableSections.forEach((section) => {
        const visibleInSection = [...section.querySelectorAll("[data-search-text]")].some((card) => !card.hidden);
        section.hidden = !visibleInSection;
      });

      if (emptyState) {
        emptyState.hidden = visibleCount > 0;
      }
    };

    if (searchInput.dataset.kbSearchBound !== "true") {
      searchInput.dataset.kbSearchBound = "true";
      searchInput.addEventListener("input", async () => {
        const hasQuery = Boolean(searchInput.value.trim());
        searchInput.closest(".kb-help-search")?.classList.toggle("has-value", hasQuery);
        applySearch();

        if (hasQuery && !loadingState.active) {
          loadingState.active = true;
          await enrichCardsWithArticleText();
          loadingState.active = false;
          applySearch();
        }
      });
    }

    if (!shortcutBound) {
      shortcutBound = true;
      document.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          document.querySelector("#kb-search-input")?.focus();
        }
      });
    }

    applySearch();
  };

  const syncLanguageSwitcher = () => {
    const currentPath = new URL(window.location.href).pathname;
    document.querySelectorAll(".kb-language-switcher a").forEach((link) => {
      const active = new URL(link.href, window.location.href).pathname === currentPath;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const refreshPage = (nextDocument, targetUrl) => {
    const nextBody = nextDocument.body;
    if (!nextBody) {
      window.location.href = targetUrl;
      return;
    }

    document.documentElement.lang = nextDocument.documentElement.lang || document.documentElement.lang;
    document.title = nextDocument.title;
    document.body.className = nextBody.className;

    const currentMain = document.querySelector("main");
    const nextMain = nextDocument.querySelector("main");
    if (currentMain && nextMain) {
      currentMain.replaceWith(nextMain);
    } else if (currentMain) {
      currentMain.remove();
    }

    const currentHeader = document.querySelector(".kb-help-header");
    const nextHeader = nextDocument.querySelector(".kb-help-header");
    if (currentHeader && nextHeader) {
      currentHeader.replaceWith(nextHeader);
    }

    const currentFooter = document.querySelector("footer");
    const nextFooter = nextDocument.querySelector("footer");
    if (currentFooter && nextFooter) {
      currentFooter.replaceWith(nextFooter);
    }

    const currentBackToTop = document.querySelector(".back-to-top");
    const nextBackToTop = nextDocument.querySelector(".back-to-top");
    if (currentBackToTop && nextBackToTop) {
      currentBackToTop.replaceWith(nextBackToTop);
    } else if (currentBackToTop && !nextBackToTop) {
      currentBackToTop.remove();
    } else if (!currentBackToTop && nextBackToTop) {
      document.body.appendChild(nextBackToTop);
    }

    history.pushState({ soft: true }, "", targetUrl);
    window.scrollTo({ top: 0, behavior: "auto" });
    initPage();
  };

  const softNavigate = async (targetUrl) => {
    try {
      const response = await fetch(targetUrl, {
        headers: { "X-Requested-With": "kb-soft-nav" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const nextDocument = new DOMParser().parseFromString(html, "text/html");
      refreshPage(nextDocument, targetUrl);
    } catch (_error) {
      window.location.href = targetUrl;
    }
  };

  const bindLanguageSwitcher = () => {
    document.querySelectorAll(".kb-language-switcher a").forEach((link) => {
      if (link.dataset.kbSoftNavBound === "true") return;
      link.dataset.kbSoftNavBound = "true";
      link.addEventListener("click", (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        const targetUrl = new URL(link.href, window.location.href);
        if (targetUrl.origin !== window.location.origin) return;
        if (targetUrl.pathname === window.location.pathname && targetUrl.hash === window.location.hash) return;

        event.preventDefault();
        softNavigate(targetUrl.href);
      });
    });
  };

  const initPage = () => {
    applyTheme(localStorage.getItem(storageKey) || "system");
    bindThemeToggle();
    bindArticleToc();
    bindSearch();
    bindLanguageSwitcher();
    syncLanguageSwitcher();
  };

  media.addEventListener("change", () => {
    if ((localStorage.getItem(storageKey) || "system") === "system") {
      applyTheme("system");
    }
  });

  window.addEventListener("popstate", () => {
    window.location.reload();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPage, { once: true });
  } else {
    initPage();
  }
})();
