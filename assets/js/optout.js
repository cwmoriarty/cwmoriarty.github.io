(function () {
  "use strict";

  var STORAGE_KEY = "optout_guide_v2";
  var LEGACY_PREFIX = "optout_guide_v1:";
  var THEME_KEY = "optout_theme_v1";

  var boxes = Array.prototype.slice.call(document.querySelectorAll("input.chk[data-item-id]"));
  var brokerRows = Array.prototype.slice.call(document.querySelectorAll(".broker-row"));
  var brokerSearch = document.getElementById("broker-search");
  var filterChips = Array.prototype.slice.call(document.querySelectorAll(".chip[data-filter]"));
  var brokerVisibleCount = document.getElementById("broker-visible-count");
  var brokerEmpty = document.getElementById("broker-empty");
  var clearBrokerBtn = document.getElementById("clear-broker-filters");
  var hideDoneBtn = document.getElementById("toggle-hide-done");
  var printBtn = document.getElementById("print-btn");
  var liveStatus = document.getElementById("live-status");

  var resetDialog = document.getElementById("reset-dialog");
  var backupDialog = document.getElementById("backup-dialog");
  var backupTextarea = document.getElementById("backup-json");
  var backupStatus = document.getElementById("backup-status");
  var copyBackupBtn = document.getElementById("copy-backup");
  var downloadBackupBtn = document.getElementById("download-backup");
  var restoreBackupBtn = document.getElementById("restore-backup");

  var mobileToggle = document.getElementById("mobile-nav-toggle");
  var mobileDrawer = document.getElementById("mobile-nav-drawer");

  var state = {};
  var activeFilter = "all";
  var hideCompleted = false;
  var announceTimer = null;

  function storageAvailable() {
    try {
      var k = "__optout_probe__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  var canStore = storageAvailable();

  function announce(msg) {
    if (!liveStatus) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      liveStatus.textContent = "";
      requestAnimationFrame(function () {
        liveStatus.textContent = msg;
      });
    }, 180);
  }

  function loadState() {
    var next = {};
    if (!canStore) {
      var note = document.querySelector("[data-storage-note]");
      if (note) note.textContent = "Browser storage disabled";
      return next;
    }

    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.done && typeof parsed.done === "object") {
          next = parsed.done;
        }
      }
    } catch (e) {
      next = {};
    }

    // Seamless migration from v1 keys (optout_guide_v1:<section>:<url>)
    var migrated = false;
    boxes.forEach(function (box) {
      var id = box.dataset.itemId;
      if (next[id]) return;
      var phase = box.dataset.phase || "";
      var legacyUrl = box.dataset.legacyUrl || "";
      if (legacyUrl && localStorage.getItem(LEGACY_PREFIX + phase + ":" + legacyUrl) === "1") {
        next[id] = true;
        migrated = true;
      }
    });

    if (migrated) {
      saveState(next);
    }
    return next;
  }

  function saveState(nextState) {
    if (!canStore) return;
    try {
      var payload = {
        version: 2,
        updatedAt: new Date().toISOString(),
        done: nextState
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  function syncUI() {
    var total = boxes.length;
    var doneTotal = 0;
    var phaseTotals = {};
    var phaseDone = {};

    boxes.forEach(function (box) {
      var id = box.dataset.itemId;
      var phase = box.dataset.phase;
      var isDone = Boolean(state[id]);

      box.checked = isDone;
      var row = box.closest(".check-row");
      if (row) {
        row.classList.toggle("is-done", isDone);
        var openTag = row.querySelector("[data-opened-tag]");
        if (openTag && isDone) openTag.hidden = true;
      }

      phaseTotals[phase] = (phaseTotals[phase] || 0) + 1;
      if (isDone) {
        doneTotal += 1;
        phaseDone[phase] = (phaseDone[phase] || 0) + 1;
      }
    });

    var pct = total > 0 ? Math.round((doneTotal / total) * 100) : 0;
    var ratio = total > 0 ? doneTotal / total : 0;

    document.querySelectorAll("[data-progress-count]").forEach(function (el) {
      el.textContent = doneTotal + " / " + total;
    });
    document.querySelectorAll("[data-progress-compact]").forEach(function (el) {
      el.textContent = doneTotal + " / " + total;
    });
    document.querySelectorAll("[data-progress-pct]").forEach(function (el) {
      el.textContent = pct + "%";
    });
    document.querySelectorAll("[data-progress-summary]").forEach(function (el) {
      el.textContent = doneTotal + " of " + total + " steps completed (" + pct + "%)";
    });
    document.querySelectorAll("[data-progress-bar]").forEach(function (el) {
      el.setAttribute("aria-valuenow", String(pct));
    });
    document.querySelectorAll("[data-progress-fill]").forEach(function (el) {
      el.style.transform = "scaleX(" + ratio + ")";
    });

    Object.keys(phaseTotals).forEach(function (phase) {
      var d = phaseDone[phase] || 0;
      var t = phaseTotals[phase];
      var complete = t > 0 && d === t;
      document.querySelectorAll('[data-phase-count="' + phase + '"]').forEach(function (el) {
        el.textContent = d + "/" + t;
        el.classList.toggle("is-complete", complete);
      });
      document.querySelectorAll('[data-segment="' + phase + '"] .segment-fill').forEach(function (fill) {
        fill.style.transform = "scaleX(" + (t > 0 ? d / t : 0) + ")";
      });
    });

    applyBrokerFilter(false);
  }

  function applyBrokerFilter(shouldAnnounce) {
    var query = brokerSearch ? brokerSearch.value.trim().toLowerCase() : "";
    var visible = 0;

    brokerRows.forEach(function (row) {
      var id = row.dataset.rowId;
      var isDone = Boolean(state[id]);
      var name = row.dataset.brokerName || "";
      var tags = row.dataset.brokerTags || "";

      var matchesQuery = !query || name.indexOf(query) !== -1 || tags.indexOf(query) !== -1;
      var matchesChip = true;

      if (activeFilter === "remaining") {
        matchesChip = !isDone;
      } else if (activeFilter !== "all") {
        matchesChip = tags.indexOf(activeFilter) !== -1;
      }

      var hiddenByGlobal = hideCompleted && isDone;
      var show = matchesQuery && matchesChip && !hiddenByGlobal;
      row.hidden = !show;
      if (show) visible += 1;
    });

    if (brokerVisibleCount) {
      brokerVisibleCount.textContent = "Showing " + visible + " of " + brokerRows.length;
    }
    if (brokerEmpty) {
      brokerEmpty.hidden = visible !== 0;
    }
    if (shouldAnnounce) {
      announce("Showing " + visible + " of " + brokerRows.length + " brokers.");
    }
  }

  // Bind checkboxes
  boxes.forEach(function (box) {
    box.addEventListener("change", function () {
      var id = box.dataset.itemId;
      if (box.checked) {
        state[id] = true;
      } else {
        delete state[id];
      }
      saveState(state);
      syncUI();
    });
  });

  // Track opened external links in-session so returning users know which row they just visited
  document.querySelectorAll("[data-track-open]").forEach(function (link) {
    link.addEventListener("click", function () {
      var id = link.dataset.trackOpen;
      var tag = document.querySelector('[data-opened-tag="' + id + '"]');
      if (tag && !state[id]) {
        tag.hidden = false;
      }
    });
  });

  // Broker search & filter chips
  if (brokerSearch) {
    brokerSearch.addEventListener("input", function () {
      applyBrokerFilter(true);
    });
  }

  filterChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      activeFilter = chip.dataset.filter || "all";
      filterChips.forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === chip));
      });
      applyBrokerFilter(true);
    });
  });

  if (clearBrokerBtn) {
    clearBrokerBtn.addEventListener("click", function () {
      activeFilter = "all";
      if (brokerSearch) brokerSearch.value = "";
      filterChips.forEach(function (c) {
        c.setAttribute("aria-pressed", String(c.dataset.filter === "all"));
      });
      if (hideCompleted && hideDoneBtn) {
        hideCompleted = false;
        hideDoneBtn.setAttribute("aria-pressed", "false");
        document.body.classList.remove("hide-completed");
      }
      applyBrokerFilter(true);
    });
  }

  // Global hide completed toggle
  if (hideDoneBtn) {
    hideDoneBtn.addEventListener("click", function () {
      hideCompleted = !hideCompleted;
      hideDoneBtn.setAttribute("aria-pressed", String(hideCompleted));
      document.body.classList.toggle("hide-completed", hideCompleted);
      applyBrokerFilter(false);
      announce(hideCompleted ? "Completed steps hidden." : "Showing all steps.");
    });
  }

  // Print button
  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  // Keyboard shortcut `/` to focus broker search
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
      return;
    }
    if ((resetDialog && resetDialog.open) || (backupDialog && backupDialog.open)) return;
    if (brokerSearch) {
      e.preventDefault();
      brokerSearch.focus();
      brokerSearch.select();
    }
  });

  // Light-dismiss fallback for browsers without native closedby (Safari)
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    var isOutside = function (e, dialog) {
      var r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    document.querySelectorAll('dialog[closedby="any"]').forEach(function (dialog) {
      var pressedOutside = false;
      dialog.addEventListener("pointerdown", function (e) {
        pressedOutside = isOutside(e, dialog);
      });
      dialog.addEventListener("pointerup", function (e) {
        if (pressedOutside && isOutside(e, dialog)) dialog.close();
      });
    });
  }

  // Reset confirmation dialog
  document.querySelectorAll("[data-open-reset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (mobileDrawer && !mobileDrawer.hidden) closeMobileDrawer();
      if (resetDialog && typeof resetDialog.showModal === "function") {
        resetDialog.showModal();
      }
    });
  });

  if (resetDialog) {
    resetDialog.addEventListener("close", function () {
      var choice = resetDialog.returnValue;
      resetDialog.returnValue = "";
      if (choice === "confirm") {
        state = {};
        if (canStore) {
          try {
            localStorage.removeItem(STORAGE_KEY);
            Object.keys(localStorage).forEach(function (k) {
              if (k.indexOf(LEGACY_PREFIX) === 0) localStorage.removeItem(k);
            });
          } catch (e) {}
        }
        document.querySelectorAll("[data-opened-tag]").forEach(function (t) {
          t.hidden = true;
        });
        syncUI();
        announce("Checklist progress reset.");
      }
    });
  }

  // Backup / Restore dialog
  function setBackupMessage(msg, isError) {
    if (!backupStatus) return;
    backupStatus.textContent = msg;
    backupStatus.classList.toggle("is-error", Boolean(isError));
  }

  function buildExportJSON() {
    var ids = Object.keys(state).filter(function (k) {
      return state[k];
    }).sort();
    return JSON.stringify({ version: 2, completed: ids }, null, 2);
  }

  document.querySelectorAll("[data-open-backup]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (mobileDrawer && !mobileDrawer.hidden) closeMobileDrawer();
      if (backupTextarea) backupTextarea.value = buildExportJSON();
      setBackupMessage("\u00a0", false);
      if (backupDialog && typeof backupDialog.showModal === "function") {
        backupDialog.showModal();
      }
    });
  });

  if (backupDialog) {
    backupDialog.addEventListener("close", function () {
      backupDialog.returnValue = "";
    });
  }

  if (copyBackupBtn) {
    copyBackupBtn.addEventListener("click", function () {
      if (!backupTextarea) return;
      var text = backupTextarea.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          setBackupMessage("Copied JSON to clipboard.", false);
        }, function () {
          backupTextarea.select();
          setBackupMessage("Select and copy the JSON above.", false);
        });
      } else {
        backupTextarea.select();
        setBackupMessage("Select and copy the JSON above.", false);
      }
    });
  }

  if (downloadBackupBtn) {
    downloadBackupBtn.addEventListener("click", function () {
      var blob = new Blob([buildExportJSON()], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "optout-guide-progress.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupMessage("Downloaded optout-guide-progress.json.", false);
    });
  }

  if (restoreBackupBtn) {
    restoreBackupBtn.addEventListener("click", function () {
      if (!backupTextarea) return;
      try {
        var parsed = JSON.parse(backupTextarea.value);
        var validIds = {};
        boxes.forEach(function (b) {
          validIds[b.dataset.itemId] = true;
        });

        var restored = {};
        var count = 0;
        if (parsed && Array.isArray(parsed.completed)) {
          parsed.completed.forEach(function (id) {
            if (validIds[id]) {
              restored[id] = true;
              count += 1;
            }
          });
        } else if (parsed && parsed.done && typeof parsed.done === "object") {
          Object.keys(parsed.done).forEach(function (id) {
            if (parsed.done[id] && validIds[id]) {
              restored[id] = true;
              count += 1;
            }
          });
        } else {
          throw new Error("Invalid format");
        }

        state = restored;
        saveState(state);
        syncUI();
        setBackupMessage("Restored " + count + " completed step" + (count === 1 ? "" : "s") + ".", false);
      } catch (e) {
        setBackupMessage("Could not parse backup JSON. Paste a valid exported backup.", true);
      }
    });
  }

  // Theme switcher (System / Light / Dark)
  var themeButtons = Array.prototype.slice.call(document.querySelectorAll(".theme-btn[data-theme-value]"));
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") {
      document.documentElement.dataset.theme = mode;
      if (canStore) {
        try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
      }
    } else {
      delete document.documentElement.dataset.theme;
      if (canStore) {
        try { localStorage.removeItem(THEME_KEY); } catch (e) {}
      }
      mode = "system";
    }
    themeButtons.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.themeValue === mode));
    });
  }

  themeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyTheme(btn.dataset.themeValue);
    });
  });

  var initialTheme = document.documentElement.dataset.theme || "system";
  applyTheme(initialTheme);

  // Mobile nav drawer
  function closeMobileDrawer() {
    if (!mobileDrawer || !mobileToggle) return;
    mobileDrawer.hidden = true;
    mobileToggle.setAttribute("aria-expanded", "false");
  }

  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener("click", function () {
      var open = mobileDrawer.hidden;
      mobileDrawer.hidden = !open;
      mobileToggle.setAttribute("aria-expanded", String(open));
    });
    mobileDrawer.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMobileDrawer);
    });
  }

  // Active sidebar section indicator via IntersectionObserver
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-row[data-nav-target]"));
  if ("IntersectionObserver" in window && navLinks.length > 0) {
    var sections = navLinks.map(function (l) {
      return document.getElementById(l.dataset.navTarget);
    }).filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          navLinks.forEach(function (link) {
            link.classList.toggle("is-active", link.dataset.navTarget === id);
          });
        }
      });
    }, { rootMargin: "-12% 0px -75% 0px", threshold: 0 });

    sections.forEach(function (s) {
      observer.observe(s);
    });
  }

  // Initialize state and render
  state = loadState();
  syncUI();
})();
