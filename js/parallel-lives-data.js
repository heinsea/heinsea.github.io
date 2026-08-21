(function() {
  var MAX_RESULTS = 80;

  function getRoot() {
    if (!window.HMAP_CONFIG || !window.HMAP_CONFIG.root) {
      return "/";
    }
    var root = window.HMAP_CONFIG.root;
    return root.endsWith("/") ? root : root + "/";
  }

  function toSiteUrl(path) {
    return getRoot() + String(path || "").replace(/^\/+/, "");
  }

  async function fetchJson(path) {
    var response = await fetch(toSiteUrl(path), { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error("Failed to load " + path + ": " + response.status);
    }
    return response.json();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeQuery(query) {
    return String(query || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function normalizeLooseText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s"'“”‘’()（）[\]【】{}<>《》,，.。:：;；、!?！？\-_/\\|]+/g, "");
  }

  function renderArticleLinks(links) {
    if (!Array.isArray(links) || !links.length) {
      return "<span class=\"pl-entry__empty\">暂无来源文章</span>";
    }

    var visibleLinks = links.slice(0, 3).map(function(link) {
      var title = "#" + escapeHtml(link.title || link.article_id || "未命名文章");
      if (link.url) {
        var footnoteTitle = link.footnote_id ? "脚注 " + escapeHtml(link.footnote_id) : "文章脚注";
        return "<a href=\"" + escapeHtml(toSiteUrl(link.url)) + "\" title=\"" + footnoteTitle + "\">" + title + "</a>";
      }
      return "<span>" + title + "</span>";
    }).join(" · ");

    if (links.length > 3) {
      visibleLinks += "<span class=\"pl-entry__more\"> +" + (links.length - 3) + "</span>";
    }

    return visibleLinks;
  }

  function renderHint(text) {
    var value = String(text || "").trim();
    if (!value) {
      return "";
    }
    return "<p class=\"pl-entry__hint\">" + escapeHtml(value) + "</p>";
  }

  function renderEntry(item) {
    return [
      "<article class=\"pl-entry\">",
      "  <p class=\"pl-entry__title\">" + escapeHtml(item.label || "") + "</p>",
      renderHint(item.hint),
      "  <p class=\"pl-entry__sources\"><span class=\"pl-entry__sources-label\">来源</span>" + renderArticleLinks(item.source_article_links || []) + "</p>",
      "</article>"
    ].join("");
  }

  function buildSearchRecord(item) {
    var label = String(item.label || "");
    var aliases = Array.isArray(item.aliases) ? item.aliases : [];
    var articleTitles = (item.source_article_details || []).map(function(article) {
      return article.title || article.id || "";
    });
    var hint = String(item.hint || "");
    var fields = [label, aliases.join(" "), articleTitles.join(" "), hint];
    var text = fields.join(" ").toLowerCase();

    return {
      item: item,
      label: label,
      labelLower: label.toLowerCase(),
      labelLoose: normalizeLooseText(label),
      aliases: aliases,
      aliasesLower: aliases.map(function(alias) {
        return String(alias || "").toLowerCase();
      }),
      aliasesLoose: aliases.map(normalizeLooseText),
      articleTitlesLower: articleTitles.map(function(title) {
        return String(title || "").toLowerCase();
      }),
      articleTitlesLoose: articleTitles.map(normalizeLooseText),
      hintLower: hint.toLowerCase(),
      textLower: text,
      textLoose: normalizeLooseText(fields.join(""))
    };
  }

  function scoreRecord(record, terms) {
    var score = 0;
    var matched = terms.every(function(term) {
      var looseTerm = normalizeLooseText(term);
      return record.textLower.indexOf(term) !== -1 || record.textLoose.indexOf(looseTerm) !== -1;
    });

    if (!matched) {
      return -1;
    }

    terms.forEach(function(term) {
      var looseTerm = normalizeLooseText(term);

      if (record.labelLower === term || record.labelLoose === looseTerm) {
        score += 140;
      } else if (record.labelLower.indexOf(term) === 0 || record.labelLoose.indexOf(looseTerm) === 0) {
        score += 84;
      } else if (record.labelLower.indexOf(term) !== -1 || record.labelLoose.indexOf(looseTerm) !== -1) {
        score += 48;
      }

      record.aliasesLower.forEach(function(aliasLower, index) {
        var aliasLoose = record.aliasesLoose[index];
        if (aliasLower === term || aliasLoose === looseTerm) {
          score += 110;
        } else if (aliasLower.indexOf(term) === 0 || aliasLoose.indexOf(looseTerm) === 0) {
          score += 68;
        } else if (aliasLower.indexOf(term) !== -1 || aliasLoose.indexOf(looseTerm) !== -1) {
          score += 36;
        }
      });

      record.articleTitlesLower.forEach(function(titleLower, index) {
        var titleLoose = record.articleTitlesLoose[index];
        if (titleLower === term || titleLoose === looseTerm) {
          score += 30;
        } else if (titleLower.indexOf(term) === 0 || titleLoose.indexOf(looseTerm) === 0) {
          score += 18;
        } else if (titleLower.indexOf(term) !== -1 || titleLoose.indexOf(looseTerm) !== -1) {
          score += 10;
        }
      });

      if (record.hintLower.indexOf(term) !== -1) {
        score += 8;
      }
    });

    score += Math.min(Number(record.item.mention_count) || 0, 20);
    return score;
  }

  function setupCollectionView(options) {
    var shell = options.shell;
    var dataPath = options.dataPath;
    var label = options.label;
    var pageSize = options.pageSize || MAX_RESULTS;

    var form = shell.querySelector(options.formSelector);
    var searchInput = shell.querySelector(options.searchSelector);
    var meta = shell.querySelector(options.metaSelector);
    var list = shell.querySelector(options.listSelector);
    var empty = shell.querySelector(options.emptySelector);

    var payloadPromise = null;
    var payloadItems = null;
    var queryToken = 0;
    var currentResults = [];

    function setMeta(text) {
      if (meta) {
        meta.textContent = text || "";
      }
    }

    function setEmpty(text) {
      if (!empty) return;
      empty.textContent = text || "";
      empty.style.display = text ? "" : "none";
    }

    function clearList() {
      if (list) {
        list.innerHTML = "";
      }
    }

    function filterItems(query) {
      var terms = normalizeQuery(query);
      if (!terms.length) {
        return [];
      }

      return payloadItems.map(buildSearchRecord).map(function(record) {
        return {
          item: record.item,
          score: scoreRecord(record, terms)
        };
      }).filter(function(result) {
        return result.score >= 0;
      }).sort(function(a, b) {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if ((b.item.mention_count || 0) !== (a.item.mention_count || 0)) {
          return (b.item.mention_count || 0) - (a.item.mention_count || 0);
        }
        return String(a.item.label || "").localeCompare(String(b.item.label || ""), "zh-Hans-CN");
      }).map(function(result) {
        return result.item;
      });
    }

    function renderResults() {
      if (!list) return;

      var visible = currentResults.slice(0, pageSize);
      list.innerHTML = visible.map(renderEntry).join("");

      if (!currentResults.length) {
        setMeta("没有匹配结果");
        setEmpty("试试更短的名称、别名，或换一个篇名关键词。");
        return;
      }

      if (currentResults.length > visible.length) {
        setMeta("找到 " + currentResults.length + " 条结果，当前显示前 " + visible.length + " 条");
      } else {
        setMeta("找到 " + currentResults.length + " 条" + label);
      }
      setEmpty("");
    }

    async function ensurePayload() {
      if (!payloadPromise) {
        payloadPromise = fetchJson(dataPath).then(function(payload) {
          payloadItems = Array.isArray(payload.items) ? payload.items : [];
          return payloadItems;
        });
      }
      return payloadPromise;
    }

    async function runQuery(query) {
      var runId = ++queryToken;
      var terms = normalizeQuery(query);

      if (!terms.length) {
        currentResults = [];
        clearList();
        setMeta("");
        setEmpty("");
        return;
      }

      setMeta("正在检索…");
      setEmpty("");

      await ensurePayload();
      if (runId !== queryToken) {
        return;
      }

      currentResults = filterItems(query);
      renderResults();
    }

    if (form) {
      form.addEventListener("submit", function(event) {
        event.preventDefault();
        runQuery(searchInput ? searchInput.value : "");
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function() {
        runQuery(searchInput.value);
      });
    }

    setMeta("");
    setEmpty("");
  }

  function initShell(shell) {
    try {
      shell.classList.add("is-loading");
      setupCollectionView({
        shell: shell,
        dataPath: "parallel-lives-data/data/entities.json",
        formSelector: ".js-pl-entities-form",
        searchSelector: ".js-pl-entities-search",
        metaSelector: ".js-pl-entities-meta",
        listSelector: ".js-pl-entities-list",
        emptySelector: ".js-pl-entities-empty",
        label: "条目",
        pageSize: MAX_RESULTS
      });
      shell.classList.remove("is-loading");
    } catch (error) {
      shell.classList.remove("is-loading");
      shell.classList.add("is-error");
      shell.innerHTML = "<p class=\"pl-error\">数据加载失败。请先重新生成 public data 文件。</p>";
      console.error(error);
    }
  }

  document.addEventListener("DOMContentLoaded", function() {
    var shell = document.querySelector(".pl-data-shell");
    if (shell) {
      initShell(shell);
    }
  });
})();
