(function () {
  "use strict";

  // ---------- Settings you may want to change ----------
  var LANGS = [
    { code: "en", name: "English" },
    { code: "or", name: "Afaan Oromoo" }
  ];
  var SETS = ["60", "242"];          // must match the data file names: data/<lang>-<set>.js
  var COUNT_CHOICES = [3, 5, 10, 20];   // plus "All"
  var MIN_PICKED = 1;                // fewest verses allowed when you choose your own
  var FIELDS = ["title", "ref", "body"];
  var FIELD_LABEL = { title: "fieldTitle", ref: "fieldRef", body: "fieldBody" };

  // ---------- Helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function t(key, vars) {
    var s = (window.STRINGS[state.lang] || window.STRINGS.en)[key];
    if (s === undefined) s = window.STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace("{" + k + "}", function () { return vars[k]; }); });
    return s;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  // ---------- Load verses from data files ----------
  // Format per line:  Title | Reference | Verse text      ("## Name" starts a section)
  function parseSet(key) {
    var raw = (window.VERSES || {})[key];
    if (typeof raw !== "string") return null;
    var items = [], group = "";
    raw.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.indexOf("//") === 0) return;
      if (line.indexOf("##") === 0) { group = line.replace(/^#+\s*/, ""); return; }
      var p = line.split("|");
      if (p.length < 3) return;
      items.push({ group: group, title: p[0].trim(), ref: p[1].trim(), body: p.slice(2).join("|").trim() });
    });
    return items;
  }
  var DATA = {};
  LANGS.forEach(function (l) {
    DATA[l.code] = {};
    SETS.forEach(function (s) { DATA[l.code][s] = parseSet(l.code + "-" + s); });
  });

  // Names of God (data/god-names.js): their capital letters are checked, all other capitals are ignored.
  var GODS = {};
  LANGS.forEach(function (l) {
    var raw = (window.GOD_NAMES || {})[l.code] || "";
    GODS[l.code] = raw.split(",").map(function (x) { return x.trim().toLocaleLowerCase(); }).filter(Boolean);
  });
  function isGodName(key) {
    var lang = state.run ? state.run.lang : state.lang, list = GODS[lang] || [];
    return list.some(function (n) { return lang === "en" ? (key === n || key === n + "s") : key.indexOf(n) === 0; });
  }

  // ---------- State ----------
  var state = {
    lang: "en", set: "60", given: "ref", section: "all", count: "10",
    shuffle: true, strict: false, run: null,
    mode: "random",     // "random" = the system chooses, "pick" = I choose the verses
    picked: {}          // my chosen verses, kept per language and set: { "en-60": { 0: true, 5: true } }
  };
  function currentItems() { return DATA[state.lang][state.set] || []; }

  // ---------- Marking ----------
  // Turn text into word tokens {raw, key, glue}. key is what gets compared.
  function tokenize(text, strict, isRef, caseNames) {
    var s = String(text || "").normalize("NFC")
      .replace(/[\u2018\u2019\u02BC`]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u1361/g, ":");                       // Ethiopic colon -> :
    if (!strict && isRef) s = s.replace(/[:.;,]/g, " "); // 3:16, 3.16, 3 16 all equal
    var re = /[^\s\-\u2013\u2014]+[-\u2013\u2014]?/g, m, out = [];
    while ((m = re.exec(s))) {
      var raw = m[0];
      var next = s.charAt(m.index + raw.length);
      var glue = /[-\u2013\u2014]$/.test(raw) && next !== "" && !/\s/.test(next);
      var key, name = false, cap = false;
      if (strict) key = raw;
      else {
        var stripped = raw.replace(/[^\p{L}\p{N}]/gu, "");
        key = stripped.toLocaleLowerCase();
        if (key && caseNames) {
          cap = stripped.charAt(0) !== stripped.charAt(0).toLocaleLowerCase();
          name = isGodName(key);
        }
      }
      if (key) out.push({ raw: raw, key: key, glue: glue, name: name, cap: cap });
    }
    return out;
  }

  // Same word? Capitals only matter when the verse writes a name of God with a capital.
  function same(e, t) { return e.key === t.key && !(e.name && e.cap && !t.cap); }

  // Compare expected vs typed words (longest common subsequence).
  function diff(expected, typed) {
    var n = expected.length, m = typed.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--)
      for (j = m - 1; j >= 0; j--)
        dp[i][j] = same(expected[i], typed[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var ops = [], ok = 0, miss = 0, extra = 0;
    i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && same(expected[i], typed[j])) { ops.push({ t: "ok", tok: expected[i] }); ok++; i++; j++; }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: "extra", tok: typed[j] }); extra++; j++; }
      else { ops.push({ t: "miss", tok: expected[i] }); miss++; i++; }
    }
    return { ops: ops, ok: ok, miss: miss, extra: extra, exp: n };
  }

  function gradeAgainst(item, answers, required, strict) {
    var res = { item: item, fields: {}, ok: 0, exp: 0, extra: 0 };
    required.forEach(function (f) {
      var d = diff(tokenize(item[f], strict, f === "ref", f !== "ref"), tokenize(answers[f], strict, f === "ref", f !== "ref"));
      d.pct = d.ok + d.extra === 0 ? 0 : Math.round(100 * d.ok / (d.exp + d.extra));
      d.perfect = d.miss === 0 && d.extra === 0;
      res.fields[f] = d;
      res.ok += d.ok; res.exp += d.exp; res.extra += d.extra;
    });
    res.score = res.ok / Math.max(1, res.exp + res.extra);
    res.pct = Math.round(100 * res.score);
    res.perfect = required.every(function (f) { return res.fields[f].perfect; });
    return res;
  }

  // Verses that share the same "given" text (e.g. same title in the same section).
  function candidates(q, given) {
    var sameKey = tokenize(q[given], false, given === "ref").map(function (x) { return x.key; }).join(" ");
    return (DATA[state.run.lang][state.run.set] || []).filter(function (c) {
      if (given === "title" && c.group !== q.group) return false;
      return tokenize(c[given], false, given === "ref").map(function (x) { return x.key; }).join(" ") === sameKey;
    });
  }

  function gradeQuestion(q, answers) {
    var r = state.run, best = null;
    candidates(q, r.given).forEach(function (c) {
      var g = gradeAgainst(c, answers, r.required, r.strict);
      if (!best || g.score > best.score || (g.score === best.score && c === q)) best = g;
    });
    return best || gradeAgainst(q, answers, r.required, r.strict);
  }

  function diffHtml(ops) {
    return ops.map(function (op) {
      var w = esc(op.tok.raw), sp = op.tok.glue ? "" : " ";
      if (op.t === "ok") return '<span class="w-ok">' + w + "</span>" + sp;
      if (op.t === "miss") return '<span class="w-miss"><span class="sr">' + esc(t("srMissing")) + " </span>" + w + "</span>" + sp;
      return '<span class="w-extra"><span class="sr">' + esc(t("srExtra")) + " </span>" + w + "</span>" + sp;
    }).join("");
  }

  function fieldResultHtml(f, d, item) {
    var h = '<div class="fix">';
    h += '<div class="fix-head"><span>' + esc(t(FIELD_LABEL[f])) + "</span>";
    h += d.perfect ? '<span class="badge good">&#10003; ' + esc(t("perfect")) + "</span>" : '<span class="badge">' + d.pct + "%</span>";
    h += "</div>";
    if (!d.perfect) {
      h += '<p class="diff ' + f + '">' + diffHtml(d.ops) + "</p>";
      h += '<p class="correct-line"><b>' + esc(t("correctAnswer")) + "</b> " + esc(item[f]) + "</p>";
    }
    return h + "</div>";
  }

  // ---------- Screens ----------
  function show(id) {
    ["setup", "test"].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  function applyLanguage() {
    document.documentElement.lang = t("htmlLang");
    document.title = t("appTitle");
    $("app-title").textContent = t("appTitle");
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
  }

  function radio(name, value, label, checked, disabled) {
    return '<label class="seg"><input type="radio" name="' + name + '" value="' + esc(value) + '"' +
      (checked ? " checked" : "") + (disabled ? " disabled" : "") + "><span>" + esc(label) + "</span></label>";
  }

  function renderSetup() {
    applyLanguage();
    $("opt-lang").innerHTML = LANGS.map(function (l) { return radio("lang", l.code, l.name, state.lang === l.code); }).join("");

    // Pick a set that exists in this language
    var available = SETS.filter(function (s) { return DATA[state.lang][s] && DATA[state.lang][s].length; });
    if (available.length && available.indexOf(state.set) < 0) state.set = available[0];
    $("opt-set").innerHTML = SETS.map(function (s) {
      var n = (DATA[state.lang][s] || []).length;
      return radio("set", s, t("verses", { n: n }), state.set === s, !n);
    }).join("");

    $("opt-mode").innerHTML =
      radio("mode", "random", t("modeRandom"), state.mode === "random") +
      radio("mode", "pick", t("modePick"), state.mode === "pick");
    $("random-opts").hidden = state.mode !== "random";
    $("pick-opts").hidden = state.mode !== "pick";

    var items = currentItems();
    var groups = [];
    items.forEach(function (it) { if (groups.indexOf(it.group) < 0) groups.push(it.group); });
    if (state.section !== "all" && groups.indexOf(state.section) < 0) state.section = "all";
    $("opt-section").innerHTML = '<option value="all">' + esc(t("allSections")) + "</option>" +
      groups.map(function (g) { return '<option value="' + esc(g) + '"' + (g === state.section ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("");

    var pool = poolItems();
    var opts = COUNT_CHOICES.filter(function (c) { return c < pool.length; });
    var html = opts.map(function (c) { return '<option value="' + c + '"' + (String(c) === state.count ? " selected" : "") + ">" + c + "</option>"; }).join("");
    html += '<option value="all"' + (state.count === "all" ? " selected" : "") + ">" + esc(t("all", { n: pool.length })) + "</option>";
    $("opt-count").innerHTML = html;
    if (state.count !== "all" && opts.map(String).indexOf(state.count) < 0) { state.count = "all"; $("opt-count").value = "all"; }

    if (state.mode === "pick") renderPicker();
    refreshStart();
  }

  // Start button + message: depends on random / pick mode
  function refreshStart() {
    var ok, msg;
    if (state.mode === "pick") {
      ok = pickedCount() >= MIN_PICKED;
      msg = t("pickAtLeast", { n: MIN_PICKED });
    } else {
      ok = poolItems().length > 0;
      msg = t("noVerses");
    }
    $("btn-start").disabled = !ok;
    $("setup-msg").hidden = ok;
    $("setup-msg").textContent = msg;
  }

  // ---------- Choose my own verses ----------
  function selKey() { return state.lang + "-" + state.set; }
  function getSel() { return state.picked[selKey()] || (state.picked[selKey()] = {}); }
  function pickedCount() { var items = currentItems(); return Object.keys(getSel()).filter(function (i) { return items[i]; }).length; }

  var MAX_SHOWN = 30;   // most suggestions shown at once

  function renderPicker() { renderSuggestions(); renderChosen(); }

  function pickKey(s) {
    return String(s).toLocaleLowerCase().replace(/\u1361/g, ":").replace(/[\u2018\u2019`]/g, "'").replace(/\s+/g, " ").trim();
  }

  // Suggestions: verses whose reference or title contains what you typed. Nothing is listed until you type.
  function renderSuggestions() {
    var q = pickKey($("pick-search").value), items = currentItems(), sel = getSel(), found = [];
    if (q) items.forEach(function (it, i) { if (pickKey(it.ref + " " + it.title).indexOf(q) >= 0) found.push(i); });
    $("pick-suggest").hidden = found.length === 0;
    $("pick-empty").hidden = !q || found.length > 0;
    $("pick-list").innerHTML = found.slice(0, MAX_SHOWN).map(function (i) {
      return '<label class="prow"><input type="checkbox" class="psel" data-i="' + i + '"' + (sel[i] ? " checked" : "") + ">" +
        '<span><span class="pref">' + esc(items[i].ref) + '</span><span class="ptitle">' + esc(items[i].title) + "</span></span></label>";
    }).join("");
    $("pick-more").hidden = found.length <= MAX_SHOWN;
    $("pick-more").textContent = t("showingFirst", { n: MAX_SHOWN });
  }

  // Your chosen verses, with a button to remove each one.
  function renderChosen() {
    var items = currentItems(), sel = getSel();
    var idx = Object.keys(sel).map(Number).filter(function (i) { return items[i]; }).sort(function (x, y) { return x - y; });
    $("chosen").hidden = idx.length === 0;
    $("pick-count").textContent = t("selectedCount", { n: idx.length });
    $("chosen-list").innerHTML = idx.map(function (i) {
      return '<div class="crow"><span><span class="pref">' + esc(items[i].ref) + '</span><span class="ptitle">' + esc(items[i].title) + "</span></span>" +
        '<button type="button" class="rm" data-i="' + i + '" aria-label="' + esc(t("remove") + " " + items[i].ref) + '">&times;</button></div>';
    }).join("");
    refreshStart();
  }

  function syncSuggestionChecks() {
    var sel = getSel();
    document.querySelectorAll("#pick-list .psel").forEach(function (box) { box.checked = !!sel[box.getAttribute("data-i")]; });
  }

  function poolItems() {
    return currentItems().filter(function (it) { return state.section === "all" || it.group === state.section; });
  }

  // ---------- Test (one page, one Submit) ----------
  function startRun(items) {
    state.run = {
      lang: state.lang, set: state.set, given: state.given, strict: state.strict,
      required: FIELDS.filter(function (f) { return f !== state.given; }),
      items: items, results: [], submitted: false
    };
    $("score-box").hidden = true;
    $("legend").hidden = true;
    $("share-box").hidden = true;
    $("viewer-banner").hidden = true;
    $("share-msg").hidden = true;
    $("btn-submit").hidden = false;
    $("btn-retry").hidden = true;
    $("btn-restart").hidden = true;
    $("btn-restart").textContent = t("startOver");
    show("test");
    renderQuestions();
  }

  function startFromSetup() {
    var pool, n;
    if (state.mode === "pick") {
      var sel = getSel();
      pool = currentItems().filter(function (it, i) { return sel[i]; });
      if (pool.length < MIN_PICKED) return;
      n = pool.length;
    } else {
      pool = poolItems();
      n = state.count === "all" ? pool.length : Math.min(parseInt(state.count, 10), pool.length);
    }
    if (state.shuffle) pool = shuffle(pool);
    startRun(pool.slice(0, n));
  }

  function renderQuestions() {
    var r = state.run, h = "";
    r.items.forEach(function (q, i) {
      h += '<section class="qcard" id="q-' + i + '">';
      h += '<div class="qhead"><span>' + esc(t("question", { i: i + 1, n: r.items.length })) + '</span><span class="qmark" id="qmark-' + i + '"></span></div>';
      h += '<div class="given"><div class="given-label">' + esc(t(FIELD_LABEL[r.given])) + "</div>";
      if (r.given === "title" && q.group) h += '<div class="given-group">' + esc(q.group) + "</div>";
      h += '<div class="given-text ' + r.given + '">' + esc(q[r.given]) + "</div>";
      var n = candidates(q, r.given).length;
      if (n > 1) h += '<div class="hint">' + esc(t("anyOf", { n: n })) + "</div>";
      h += "</div>";
      r.required.forEach(function (f) {
        var id = "ans-" + i + "-" + f;
        h += '<div class="ans"><label for="' + id + '">' + esc(t(FIELD_LABEL[f])) + "</label>";
        h += f === "body"
          ? '<textarea id="' + id + '" rows="5" placeholder="' + esc(t("typeHere")) + '" spellcheck="false" autocorrect="off" autocomplete="off"></textarea>'
          : '<input id="' + id + '" type="text" placeholder="' + esc(t("typeHere")) + '" spellcheck="false" autocorrect="off" autocapitalize="words" autocomplete="off">';
        h += '<div class="result" id="res-' + i + "-" + f + '"></div></div>';
      });
      h += "</section>";
    });
    $("questions").innerHTML = h;
    window.scrollTo(0, 0);
    // On phones, focusing a box opens the keyboard straight away, so only do it on computers.
    var first = $("questions").querySelector("input, textarea");
    var touch = navigator.maxTouchPoints > 0 || (window.matchMedia && matchMedia("(pointer: coarse)").matches);
    if (first && !touch) first.focus();
  }

  function submitAll() {
    var r = state.run;
    if (r.submitted) return;
    r.submitted = true;
    r.results = [];
    var total = 0, perfect = 0;
    r.items.forEach(function (q, i) {
      var answers = {};
      r.required.forEach(function (f) { answers[f] = $("ans-" + i + "-" + f).value; });
      var g = gradeQuestion(q, answers);
      g.answers = answers;
      r.results.push(g);
      total += g.pct;
      if (g.perfect) perfect++;
      $("q-" + i).classList.add(g.perfect ? "is-perfect" : "is-wrong");
      $("qmark-" + i).textContent = g.perfect ? "\u2713 " + t("perfect") : g.pct + "%";
      r.required.forEach(function (f) {
        $("ans-" + i + "-" + f).readOnly = true;
        $("res-" + i + "-" + f).innerHTML = fieldResultHtml(f, g.fields[f], g.item);
      });
    });
    var avg = r.items.length ? Math.round(total / r.items.length) : 0;
    $("score-big").textContent = avg + "%";
    $("score-sub").textContent = t("scoreLine", { p: perfect, n: r.items.length });
    $("legend").textContent = t("legend");
    $("score-box").hidden = false;
    $("legend").hidden = false;
    $("btn-submit").hidden = true;
    $("btn-retry").hidden = r.viewer || perfect === r.items.length;
    $("btn-restart").hidden = false;
    r.avg = avg; r.perfect = perfect;
    if (!r.viewer) {
      $("share-box").hidden = false;
      $("share-name").value = state.name || "";
      refreshShare();
    }
    window.scrollTo(0, 0);
  }

  // ---------- Share the result (link + message for WhatsApp etc.) ----------
  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    var bin = atob(str), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  async function pack(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    try {
      if (window.CompressionStream) {
        var out = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
        return "1" + b64url(new Uint8Array(await new Response(out).arrayBuffer()));
      }
    } catch (e) { /* fall back to plain */ }
    return "0" + b64url(bytes);
  }
  async function unpack(str) {
    var bytes = unb64url(str.slice(1));
    if (str.charAt(0) === "1") {
      var out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(out).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function buildLink(name) {
    var r = state.run, base = location.href.split("#")[0];
    var head = { v: 1, n: name, l: r.lang, s: r.set, d: new Date().toISOString().slice(0, 10) };
    var full = Object.assign({ k: r.strict ? 1 : 0, q: r.results.map(function (g) {
      return [g.item.ref].concat(r.required.map(function (f) { return g.answers[f]; }));
    }) }, head);
    var url = base + "#r=" + await pack(full);
    if (url.length > 6000) {   // too long to share nicely: send scores only
      var light = Object.assign({ q: r.results.map(function (g) { return [g.item.ref, g.pct]; }) }, head);
      url = base + "#r=" + await pack(light);
    }
    return url;
  }

  async function refreshShare() {
    var r = state.run, name = $("share-name").value.trim();
    var url = await buildLink(name);
    var langName = LANGS.filter(function (l) { return l.code === r.lang; })[0].name;
    var text = t("shareMsg", {
      name: name || "?", set: t("verses", { n: (DATA[r.lang][r.set] || []).length }), lang: langName,
      score: r.avg, p: r.perfect, n: r.items.length, url: url
    });
    r.share = { url: url, text: text };
    $("btn-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(text);
  }

  function shareMessage(text, ok) {
    var m = $("share-msg");
    m.textContent = text; m.className = "msg" + (ok ? " ok" : ""); m.hidden = false;
  }
  function ensureName() {
    if ($("share-name").value.trim()) return true;
    shareMessage(t("nameFirst"), false);
    $("share-name").focus();
    return false;
  }

  // ---------- Open a shared result link ----------
  async function openShared(code) {
    var p = await unpack(code);
    if (!p || p.v !== 1 || !DATA[p.l] || !DATA[p.l][p.s] || !Array.isArray(p.q)) throw new Error("bad");
    state.lang = p.l; state.set = p.s; state.strict = !!p.k;
    var all = DATA[p.l][p.s], items = [], rows = [], missing = 0;
    p.q.forEach(function (row) {
      var it = all.filter(function (x) { return x.ref === row[0]; })[0];
      if (it) { items.push(it); rows.push(row); } else missing++;
    });
    applyLanguage();
    var banner = '<b>' + esc(t("sharedBy", { name: p.n || "?" })) + "</b>";
    if (p.d) banner += "<div>" + esc(t("sharedOn", { date: p.d })) + "</div>";
    if (missing) banner += "<div>" + esc(t("missingVerses", { n: missing })) + "</div>";

    if (rows.length && rows[0].length === 3) {            // full result with answers
      startRun(items);
      state.run.viewer = true;
      rows.forEach(function (row, i) {
        $("ans-" + i + "-title").value = row[1];
        $("ans-" + i + "-body").value = row[2];
      });
      submitAll();
    } else {                                              // scores only
      state.run = { lang: p.l, set: p.s, items: items, required: [], viewer: true };
      show("test");
      $("btn-submit").hidden = true; $("btn-retry").hidden = true; $("share-box").hidden = true;
      var tot = 0, perf = 0;
      $("questions").innerHTML = rows.map(function (row, i) {
        var pct = row[1]; tot += pct; if (pct === 100) perf++;
        return '<div class="lrow' + (pct === 100 ? " is-perfect" : "") + '"><span class="qmark">' +
          (pct === 100 ? "&#10003;" : pct + "%") + "</span><b>" + esc(items[i].ref) + '</b><span class="t">' + esc(items[i].title) + "</span></div>";
      }).join("");
      $("score-big").textContent = (items.length ? Math.round(tot / items.length) : 0) + "%";
      $("score-sub").textContent = t("scoreLine", { p: perf, n: items.length });
      $("score-box").hidden = false;
      banner += "<div>" + esc(t("scoreOnly")) + "</div>";
    }
    $("viewer-banner").innerHTML = banner;
    $("viewer-banner").hidden = false;
    $("btn-restart").hidden = false;
    $("btn-restart").textContent = t("takeTest");
    window.scrollTo(0, 0);
  }

  function retryMissed() {
    var r = state.run;
    var missed = r.results.filter(function (g) { return !g.perfect; }).map(function (g) { return g.item; });
    if (missed.length) { state.lang = r.lang; state.set = r.set; startRun(state.shuffle ? shuffle(missed) : missed); }
  }

  // ---------- Wire up ----------
  $("setup-form").addEventListener("change", function (e) {
    var el = e.target;
    if (el.name === "mode") state.mode = el.value;
    else if (el.name === "lang") { state.lang = el.value; state.section = "all"; }
    else if (el.name === "set") { state.set = el.value; state.section = "all"; }
    else if (el.id === "opt-section") state.section = el.value;
    else if (el.id === "opt-count") state.count = el.value;
    renderSetup();
  });
  // Choosing verses: handled here, so the setup page is not rebuilt.
  $("pick-opts").addEventListener("change", function (e) {
    e.stopPropagation();
    var el = e.target;
    if (!el.classList.contains("psel")) return;
    var sel = getSel(), i = el.getAttribute("data-i");
    if (el.checked) sel[i] = true; else delete sel[i];
    renderChosen();
  });
  $("pick-search").addEventListener("input", renderSuggestions);
  $("pick-all").addEventListener("click", function () {
    var sel = getSel();
    document.querySelectorAll("#pick-list .psel").forEach(function (box) { sel[box.getAttribute("data-i")] = true; box.checked = true; });
    renderChosen();
  });
  $("pick-none").addEventListener("click", function () { state.picked[selKey()] = {}; renderPicker(); });
  $("chosen-list").addEventListener("click", function (e) {
    var b = e.target.closest(".rm");
    if (!b) return;
    delete getSel()[b.getAttribute("data-i")];
    renderChosen();
    syncSuggestionChecks();
  });
  $("setup-form").addEventListener("submit", function (e) { e.preventDefault(); startFromSetup(); });
  $("btn-submit").addEventListener("click", submitAll);
  var nameTimer;
  $("share-name").addEventListener("input", function () {
    state.name = this.value;
    $("share-msg").hidden = true;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(refreshShare, 150);
  });
  $("btn-whatsapp").addEventListener("click", function (e) { if (!ensureName()) e.preventDefault(); });
  if (navigator.share) $("btn-share").hidden = false;
  $("btn-share").addEventListener("click", function () {
    if (!ensureName()) return;
    navigator.share({ text: state.run.share.text }).catch(function () {});
  });
  $("btn-copy").addEventListener("click", function () {
    if (!ensureName()) return;
    var text = state.run.share.text;
    function done() { shareMessage(t("copied"), true); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
    else legacy();
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });
  $("btn-retry").addEventListener("click", retryMissed);
  $("btn-restart").addEventListener("click", function () {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    state.strict = false;
    show("setup"); renderSetup();
  });

  // Shuffle and Strict options were removed (order is always shuffled, marking is never strict).
  // This also hides them if an older index.html is still on the website.
  ["opt-shuffle", "opt-strict"].forEach(function (id) {
    var box = $(id), label = box && box.closest("label");
    if (label) label.parentNode.removeChild(label);
  });

  renderSetup();
  show("setup");
  if (location.hash.indexOf("#r=") === 0) {
    openShared(location.hash.slice(3)).catch(function () {
      show("setup");
      $("setup-msg").hidden = false;
      $("setup-msg").textContent = t("linkBad");
    });
  }

  // exposed for quick testing in the browser console / automated tests
  window.__test = { tokenize: tokenize, diff: diff, state: state, pack: pack, unpack: unpack };
})();
