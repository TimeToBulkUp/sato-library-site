// Dr. Sato Library — 静的サイト版（GitHub Pages 用）
// データは build で作られる data/catalog.json と data/transcripts/*.txt を読む。
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MONTH_LABEL = (s) => s.kind === "ex" ? "番外編" : `${s.month}月${s.kind === "sp" ? "特別回" : s.kind === "add" ? "追加版" : ""}`;
  // 番外編は勉強会と時期が関係ないので年月を出さず、講座番号を出す
  const YM = (s) => s.kind === "ex" ? `講座${state.exNo.get(s.id) || ""}` : `${s.year}.${String(s.month).padStart(2, "0")}`;

  const state = {
    sessions: [], byId: new Map(), exNo: new Map(), xposts: [], xFocus: null, years: new Map(), generatedAt: "",
    transcripts: null, transcriptsLoading: null, transcriptCache: new Map(),
    view: "home", current: null, tab: "summary", category: "reg", searchQuery: "", loaded: false, error: "",
  };
  const inCat = (s) => (state.category === "ex" ? s.kind === "ex" : s.kind !== "ex");

  /* ---------- 暗号化（data/lock.json があるときはパスワードが必要） ---------- */
  const LOCK = { meta: null, key: null };
  const KEY_STORE = "sato-library-key";
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  // 読んだ回（この端末のブラウザに保存）
  const READ_STORE = "sato-library-read";
  const readSet = new Set((() => { try { return JSON.parse(lsGet(READ_STORE) || "[]"); } catch { return []; } })());
  const isRead = (id) => readSet.has(id);
  function toggleRead(id) {
    readSet.has(id) ? readSet.delete(id) : readSet.add(id);
    lsSet(READ_STORE, JSON.stringify([...readSet]));
  }
  const CHECK_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  async function deriveKey(pw) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64d(LOCK.meta.salt), iterations: LOCK.meta.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function decryptBytes(buf, key = LOCK.key) {
    const b = new Uint8Array(buf);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12)));
  }
  async function fetchBin(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return decryptBytes(await r.arrayBuffer());
  }
  const fetchBinJson = async (url) => JSON.parse(new TextDecoder().decode(await fetchBin(url)));
  // 画像：暗号化時は <img data-enc> にしておき、表示後に復号して差し込む
  const imgSrc = (u) => LOCK.meta && !/^https:/i.test(u) ? `src="${PIXEL}" data-enc="${esc(u)}"` : `src="${esc(u)}"`;
  const blobUrls = new Map();
  async function hydrateImg(img) {
    const u = img.dataset.enc; img.removeAttribute("data-enc");
    try {
      let url = blobUrls.get(u);
      if (!url) {
        const ext = (u.split(".").pop() || "").toLowerCase();
        const type = { jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" }[ext] || "image/png";
        url = URL.createObjectURL(new Blob([await fetchBin(u + ".bin")], { type }));
        blobUrls.set(u, url);
      }
      img.src = url;
      const z = img.closest(".zoom"); if (z) z.dataset.src = url;
    } catch { img.alt = "（画像を読み込めませんでした）"; }
  }
  // 動画：暗号化時は画面に近づいてから復号して再生する（一度に全部読み込まない）
  const isVideo = (u) => /\.mp4$/i.test(u);
  const vidSrc = (u) => LOCK.meta ? `data-encv="${esc(u)}"` : `src="${esc(u)}"`;
  const vio = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { vio.unobserve(e.target); hydrateVideo(e.target); }
  }), { rootMargin: "300px" }) : null;
  async function hydrateVideo(v) {
    const u = v.dataset.encv; v.removeAttribute("data-encv");
    try {
      let url = blobUrls.get(u);
      if (!url) { url = URL.createObjectURL(new Blob([await fetchBin(u + ".bin")], { type: "video/mp4" })); blobUrls.set(u, url); }
      v.src = url;
      v.play().catch(() => {});
    } catch { v.replaceWith(Object.assign(document.createElement("p"), { className: "status err", textContent: "（動画を読み込めませんでした）" })); }
  }
  new MutationObserver(() => {
    document.querySelectorAll("img[data-enc]").forEach(hydrateImg);
    document.querySelectorAll("video[data-encv]").forEach((v) => (vio ? vio.observe(v) : hydrateVideo(v)));
  }).observe(document.body, { childList: true, subtree: true });

  function askPassword(tryKey) {
    return new Promise((resolve) => {
      const app = $("#app"), gate = $("#gate");
      app.hidden = true; gate.hidden = false;
      gate.innerHTML = `<form class="gate-card" id="gateForm">
          <h1>Dr. Sato Library</h1>
          <p class="hint">パスワードを入力してください。</p>
          <input id="pw" type="password" autocomplete="current-password" aria-label="パスワード" required>
          <label class="opt"><input type="checkbox" id="remember" checked> この端末では次から入力しない</label>
          <button class="btn primary" type="submit">開く</button>
          <p class="status err" id="gateMsg" role="alert"></p>
        </form>`;
      $("#pw").focus();
      $("#gateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = $("#gateMsg"), btn = $("#gateForm button");
        msg.textContent = ""; btn.disabled = true; btn.textContent = "確認中…";
        try {
          const key = await deriveKey($("#pw").value);
          const cat = await tryKey(key);
          if ($("#remember").checked) lsSet(KEY_STORE, b64e(await crypto.subtle.exportKey("raw", key)));
          gate.hidden = true; gate.innerHTML = ""; app.hidden = false;
          resolve(cat);
        } catch (err) {
          msg.textContent = err && err.name === "OperationError" ? "パスワードが違います。" : "読み込めませんでした。通信状態を確認してください。";
          btn.disabled = false; btn.textContent = "開く"; $("#pw").select();
        }
      });
    });
  }
  async function unlockCatalog() {
    const tryKey = async (key) => { const cat = JSON.parse(new TextDecoder().decode(await decryptBytes(raw, key))); LOCK.key = key; return cat; };
    const r = await fetch("data/catalog.bin", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const raw = await r.arrayBuffer();
    const saved = lsGet(KEY_STORE);
    if (saved) {
      try { return await tryKey(await crypto.subtle.importKey("raw", b64d(saved), "AES-GCM", true, ["decrypt"])); }
      catch { lsSet(KEY_STORE, null); }
    }
    return askPassword(tryKey);
  }
  window.addEventListener("click", (e) => {
    if (e.target.closest("[data-act=forget]")) { lsSet(KEY_STORE, null); location.reload(); }
  });

  /* ---------- markdown（エスケープしてから最小限だけ変換） ---------- */
  function safeSrc(src) {
    // 相対パスと https のみ許可
    if (/^(https:\/\/|[a-z0-9_.\-\/]+$)/i.test(src) && !/^\/\//.test(src) && !/\.\./.test(src)) return src;
    return "";
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
      const u = safeSrc(src.replace(/&amp;/g, "&"));
      return u ? `<button class="zoom" type="button" data-src="${esc(u)}" data-cap="${alt}"><img ${imgSrc(u)} alt="${alt}" loading="lazy"></button>` : m;
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/【(\d{4}-\d{2}(?:(?:-sp|-add|-ex)\d*)?)】/g, (m, id) => {
      const ss = state.byId.get(id);
      return ss ? `<a class="cite" href="#s-${id}">${ss.kind === "ex" ? `番外編・${YM(ss)}` : `${ss.year}年${MONTH_LABEL(ss)}`}</a>` : m;
    });
    return s;
  }
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let html = "", i = 0;
    const listStack = [];
    const closeLists = (to = 0) => { while (listStack.length > to) html += `</li></${listStack.pop()}>`; };
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { closeLists(); i++; continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        closeLists();
        const lv = Math.min(4, Math.max(2, h[1].length));
        const txt = h[2].trim();
        const cls = /気になった点|気になる点/.test(txt) ? ' class="concern"' : "";
        html += `<h${lv}${cls}>${inline(txt)}</h${lv}>`; i++; continue;
      }
      const img = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (img) {
        closeLists();
        const u = safeSrc(img[2]);
        if (u && isVideo(u)) html += `<figure class="shotfig"><video class="clip" ${vidSrc(u)} autoplay loop muted playsinline controls preload="metadata" aria-label="${esc(img[1])}"></video>${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ""}</figure>`;
        else if (u) html += `<figure class="shotfig"><button class="zoom" type="button" data-src="${esc(u)}" data-cap="${esc(img[1])}"><img ${imgSrc(u)} alt="${esc(img[1])}" loading="lazy"></button>${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ""}</figure>`;
        i++; continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeLists();
        const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = row(line); i += 2;
        let t = '<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += "<tr>" + row(lines[i]).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>"; i++; }
        html += t + "</tbody></table></div>"; continue;
      }
      const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (li) {
        const spaces = li[1].replace(/\t/g, "    ").length;
        const level = Math.min(Math.ceil(spaces / 4), 3) + 1;
        const type = /\d+\./.test(li[2]) ? "ol" : "ul";
        if (listStack.length < level) { while (listStack.length < level) { html += `<${type}><li>`; listStack.push(type); } }
        else { closeLists(level); html += "</li><li>"; }
        html += inline(li[3]); i++; continue;
      }
      closeLists();
      const para = [line.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*]|\d+\.)\s|\s*\||\s*!\[)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
      html += `<p>${inline(para.join(" "))}</p>`;
    }
    closeLists();
    return html;
  }

  /* ---------- helpers ---------- */
  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();
  const sortKey = (s) => s.year * 100 + s.month + (s.kind === "add" ? 0.3 : s.kind === "sp" ? 0.6 : 0);
  const terms = (q) => norm(q).split(/[\s　,、]+/).filter(Boolean);
  function snippet(text, ts, width = 70) {
    const n = norm(text);
    let pos = -1;
    for (const t of ts) { const p = n.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
    if (pos < 0) return null;
    const start = Math.max(0, pos - width), end = Math.min(text.length, pos + width * 2);
    let s = esc((start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : ""));
    for (const t of ts) s = s.replace(new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
    return s;
  }
  const stripMd = (s) => String(s || "").replace(/^#+\s*/gm, "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/\|/g, " ");
  function leadOf(summary) {
    const p = String(summary || "").split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^[#|\-*!]/.test(x));
    return p ? p.replace(/\s+/g, " ") : "";
  }
  const countImages = (s) => (String(s.summary || "").match(/!\[[^\]]*\]\([^)]+\)/g) || []).filter((m) => !/\.mp4\)$/i.test(m)).length;
  const countVideos = (s) => (String(s.summary || "").match(/!\[[^\]]*\]\([^)]+\.mp4\)/gi) || []).length;

  /* ---------- data ---------- */
  async function loadCatalog() {
    try {
      const lk = await fetch("data/lock.json", { cache: "no-cache" });
      let cat;
      if (lk.ok) { LOCK.meta = await lk.json(); cat = await unlockCatalog(); }
      else {
        const r = await fetch("data/catalog.json", { cache: "no-cache" });
        if (!r.ok) throw new Error(r.status);
        cat = await r.json();
      }
      const list = cat.sessions.map((s) => ({ ...s, _key: sortKey(s) })).sort((a, b) => b._key - a._key);
      state.sessions = list;
      state.byId = new Map(list.map((s) => [s.id, s]));
      state.exNo = new Map(list.filter((s) => s.kind === "ex").map((s) => s.id).sort().map((id, i) => [id, i + 1]));
      state.years = new Map(Object.entries(cat.years || {}));
      state.xposts = cat.xposts || [];
      state.generatedAt = cat.generatedAt || "";
    } catch (e) {
      state.error = "データを読み込めませんでした。npm run build を実行したか、data/catalog.json があるか確認してください。";
    }
    state.loaded = true;
    route();
  }
  async function getTranscript(id) {
    if (state.transcriptCache.has(id)) return state.transcriptCache.get(id);
    if (state.transcripts) return state.transcripts[id] || "";
    if (LOCK.meta) return (await loadAllTranscripts())[id] || "";
    const r = await fetch(`data/transcripts/${encodeURIComponent(id)}.txt`);
    const t = r.ok ? await r.text() : "";
    state.transcriptCache.set(id, t);
    return t;
  }
  function loadAllTranscripts() {
    if (state.transcripts) return Promise.resolve(state.transcripts);
    if (!state.transcriptsLoading) {
      state.transcriptsLoading = (LOCK.meta ? fetchBinJson("data/transcripts.bin") : fetch("data/transcripts.json").then((r) => r.json())).then((j) => (state.transcripts = j))
        .finally(() => { state.transcriptsLoading = null; });
    }
    return state.transcriptsLoading;
  }

  /* ---------- routing ---------- */
  function go(hash) { if (location.hash !== "#" + hash) location.hash = hash; else route(); }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith("s-")) { state.view = "detail"; state.current = h.slice(2); state.tab = "summary"; }
    else if (h.startsWith("y")) { state.view = "year"; state.current = h.slice(1); }
    else if (h === "results" && state.searchQuery) { state.view = "results"; }
    else if (h === "x" || h.startsWith("x-")) { state.view = "x"; state.category = "x"; state.xMonth = h.startsWith("x-") ? h.slice(2) : null; }
    else { state.view = "home"; }
    // X 以外の画面に移ったら、サイドバーは見ている回の分類に戻す
    const cur = state.view === "detail" && state.byId.get(state.current);
    if (cur) state.category = cur.kind === "ex" ? "ex" : "reg";
    else if (state.view !== "x" && state.category === "x") state.category = "reg";
    $("#app").dataset.view = state.view;
    document.querySelectorAll("#catTabs .tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === state.category)));
    renderIndex(); renderMain();
    if (state.view === "x" && (state.xFocus || state.xMonth)) {
      const el = document.getElementById(state.xFocus ? `xp-${state.xFocus}` : `xm-${state.xMonth}`);
      if (el) { el.scrollIntoView({ block: "start" }); if (state.xFocus) { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1800); } }
      state.xFocus = null;
    } else window.scrollTo(0, 0);
  }

  /* ---------- render ---------- */
  function renderIndex() {
    const nav = $("#index");
    if (!state.loaded) return;
    $("#pubInfo").textContent = state.generatedAt ? `最終更新 ${state.generatedAt} · ${state.sessions.length}回分` : "";
    if (state.error) { nav.innerHTML = `<p class="empty" style="padding:0 10px">${esc(state.error)}</p>`; return; }
    if (state.category === "x") {
      const months = xMonths();
      nav.innerHTML = months.length
        ? `<div class="year-group">${months.map(([ym, list]) => `<a class="sess xmon${state.view === "x" && state.xMonth === ym ? " on" : ""}" href="#x-${ym}"><span class="plate x"></span><span class="ym">${ym.slice(5)}月</span><span class="t">${ym.slice(0, 4)}年${Number(ym.slice(5))}月<span class="meta">${list.length}件</span></span></a>`).join("")}</div>`
        : `<p class="empty" style="padding:0 10px">X の投稿はまだありません。</p>`;
      return;
    }
    const sessLink = (s) => {
      const on = state.view === "detail" && state.current === s.id ? " on" : "";
      const n = countImages(s), nv = countVideos(s);
      const ym = s.kind === "ex" ? `講座${state.exNo.get(s.id)}` : `${String(s.month).padStart(2, "0")}${s.kind === "sp" ? " 特" : s.kind === "add" ? " 追" : ""}`;
      const rd = isRead(s.id);
      return `<div class="sess-row${rd ? " read" : ""}"><a class="sess${on}" href="#s-${s.id}"><span class="plate ${s.kind || ""}"></span><span class="ym">${ym}</span><span class="t">${esc(s.title || "（無題）")}<span class="meta">${esc(s.cohort || "")}${n ? ` · スクショ${n}` : ""}${nv ? ` · 動画${nv}` : ""}</span></span></a><button class="readchk" type="button" data-read="${s.id}" aria-pressed="${rd}" title="${rd ? "読んだ印を外す" : "読んだ印をつける"}" aria-label="${esc(s.title || "")}を${rd ? "未読に戻す" : "読んだにする"}">${CHECK_SVG}</button></div>`;
    };
    let html = "";
    if (state.category === "ex") {
      // 番外編は勉強会と時期が関係ないので、年で分けずに講座の順に並べる
      const list = state.sessions.filter(inCat).sort((a, b) => state.exNo.get(a.id) - state.exNo.get(b.id));
      html = list.length ? `<div class="year-group">${list.map(sessLink).join("")}</div>` : `<p class="empty" style="padding:0 10px">番外編はまだありません。</p>`;
    } else {
      const groups = new Map();
      state.sessions.filter(inCat).forEach((s) => { if (!groups.has(s.year)) groups.set(s.year, []); groups.get(s.year).push(s); });
      if (!groups.size) html = `<p class="empty" style="padding:0 10px">勉強会の回はまだありません。</p>`;
      groups.forEach((list, year) => {
        html += `<div class="year-group"><button class="year-head" type="button" data-year="${year}"><b>${year}</b><span>${list.filter((x) => isRead(x.id)).length}/${list.length}本 読了 · 年間まとめ</span></button>`;
        html += list.slice().sort((a, b) => b._key - a._key).map(sessLink).join("") + "</div>";
      });
    }
    nav.innerHTML = html;
  }

  function renderMain() {
    if (!state.loaded) { $("#main").innerHTML = '<div class="page"><p class="status"><span class="spinner"></span>読み込み中…</p></div>'; return; }
    if (state.error) { $("#main").innerHTML = `<div class="page"><div class="notice">${esc(state.error)}</div></div>`; return; }
    if (state.view === "detail") return renderDetail();
    if (state.view === "year") return renderYear();
    if (state.view === "results") return renderResults();
    if (state.view === "x") return renderX();
    return renderHome();
  }
  const backBtn = () => '<button class="btn small back" type="button" data-act="home">← 一覧へ</button>';
  const hitHtml = (s, snip, src) => `<button class="hit" type="button" data-open="${s.id}">
      <span class="h"><span class="ym">${YM(s)}</span><span class="chip ${s.kind || ""}">${esc(MONTH_LABEL(s))}</span>${esc(s.title || "")}</span>
      ${snip ? `<span class="snip">${snip}</span>` : ""}${src ? `<span class="src">${esc(src)}</span>` : ""}
    </button>`;

  /* ---------- X の投稿（タイムライン） ---------- */
  const xMonths = () => {
    const m = new Map();
    state.xposts.forEach((p) => { const k = p.date.slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
    return [...m.entries()];
  };
  const xDate = (d) => d.replace(/-/g, ".");
  function xMedia(md) {
    const u = safeSrc(md.src);
    if (!u) return "";
    if (isVideo(u)) {
      const cap = md.cap ? `<figcaption>${esc(md.cap)}</figcaption>` : "";
      return LOCK.meta
        ? `<figure class="xfig"><button class="xplay" type="button" data-xplay="${esc(u)}"><span class="xplay-ic" aria-hidden="true">▶</span><span>画面録画を再生</span></button>${cap}</figure>`
        : `<figure class="xfig"><video class="xvid" src="${esc(u)}" controls playsinline preload="metadata"></video>${cap}</figure>`;
    }
    return `<figure class="xfig"><button class="zoom" type="button" data-src="${esc(u)}" data-cap="${esc(md.cap)}"><img ${imgSrc(u)} alt="${esc(md.cap || "投稿のスクリーンショット")}" loading="lazy"></button>${md.cap ? `<figcaption>${esc(md.cap)}</figcaption>` : ""}</figure>`;
  }
  function xCard(p) {
    const name = p.author || p.handle || "X の投稿";
    return `<article class="xpost" id="xp-${p.id}">
      <header class="xhead">
        <span class="xav" aria-hidden="true">${esc((name.replace(/^@/, "")[0] || "X").toUpperCase())}</span>
        <div class="xwho"><b>${esc(name)}</b>${p.handle && p.author ? ` <span class="xhandle">${esc(p.handle)}</span>` : ""}<span class="xdate">${xDate(p.date)}</span></div>
        ${p.url ? `<a class="xlink" href="${esc(p.url)}" target="_blank" rel="noopener">X で開く ↗</a>` : ""}
      </header>
      ${p.memo ? `<div class="xmemo md">${md(p.memo)}</div>` : ""}
      <div class="xmedia${p.media.length > 1 ? " multi" : ""}">${p.media.map(xMedia).join("")}</div>
      ${p.tags.length ? `<div class="xtags">${p.tags.map((t) => `<button class="chip muted" type="button" data-xtag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
      ${p.text ? `<details class="xtext"><summary>投稿の本文（テキスト）</summary><div class="md">${md(p.text)}</div></details>` : ""}
    </article>`;
  }
  function renderX() {
    const months = xMonths();
    const body = months.length
      ? months.map(([ym, list]) => `<section class="xmonth" id="xm-${ym}"><h3 class="xmonth-h">${ym.slice(0, 4)}年${Number(ym.slice(5))}月 <span>${list.length}件</span></h3>${list.map(xCard).join("")}</section>`).join("")
      : `<div class="card"><p class="empty">まだ投稿がありません。スクショや画面録画を「X投稿入れる場所」に入れて、Claude Code に「X の投稿を追加して」と頼んでください。</p></div>`;
    $("#main").innerHTML = `<div class="page xpage">
      ${backBtn()}
      <div class="page-head"><div class="crumbs"><span class="chip x">X</span><span>${state.xposts.length}件</span></div><h2>X の投稿</h2></div>
      <div class="xline">${body}</div>
    </div>`;
  }
  async function playX(btn) {
    const u = btn.dataset.xplay;
    btn.disabled = true; btn.querySelector("span:last-child").textContent = "読み込み中…";
    try {
      let url = blobUrls.get(u);
      if (!url) { url = URL.createObjectURL(new Blob([await fetchBin(u + ".bin")], { type: "video/mp4" })); blobUrls.set(u, url); }
      const v = Object.assign(document.createElement("video"), { className: "xvid", src: url, controls: true, playsInline: true, autoplay: true });
      btn.replaceWith(v);
    } catch { btn.disabled = false; btn.querySelector("span:last-child").textContent = "読み込めませんでした（もう一度押す）"; }
  }

  function renderHome() {
    const shots = state.sessions.reduce((a, s) => a + countImages(s), 0);
    const withT = state.sessions.filter((s) => s.hasTranscript).length;
    $("#main").innerHTML = `<div class="page">
      <div class="page-head"><h2>勉強会の記録</h2></div>
      <div class="stats">
        <div class="stat"><b>${state.sessions.length}</b><span>回分の要約</span></div>
        <div class="stat"><b>${withT}</b><span>回分の文字起こし</span></div>
        <div class="stat"><b>${shots}</b><span>枚のスクリーンショット</span></div>
      </div>
      <div class="card"><div class="md">
        <h3>使い方</h3>
        <ul>
          <li><strong>読む</strong>：左の一覧から年と月を選ぶと、その回の要約・スクリーンショット・文字起こしが見られます。年の見出しを押すと年間まとめ。</li>
          <li><strong>検索</strong>：左上の検索欄にキーワードを入れると、要約と文字起こしから該当箇所を探します。</li>
        </ul>
      </div></div>
      <div class="results"><h3 style="margin:0;font-family:var(--f-display)">最近の回</h3>${state.sessions.filter((s) => s.kind !== "ex").slice(0, 4).map((s) => hitHtml(s, esc(leadOf(s.summary).slice(0, 120)) + "…", "")).join("")}</div>
    </div>`;
  }

  function renderDetail() {
    const s = state.byId.get(state.current);
    if (!s) { $("#main").innerHTML = `<div class="page">${backBtn()}<p class="empty">この回は見つかりませんでした。</p></div>`; return; }
    $("#main").innerHTML = `<div class="page">
      ${backBtn()}
      <div class="page-head">
        <div class="crumbs"><span>${YM(s)}</span><span class="chip ${s.kind || ""}">${esc(MONTH_LABEL(s))}</span>${s.cohort ? `<span class="chip muted">${esc(s.cohort)}</span>` : ""}</div>
        <h2>${esc(s.title || "（無題）")}</h2>
        <button class="btn readbtn${isRead(s.id) ? " is-read" : ""}" type="button" data-read="${s.id}" aria-pressed="${isRead(s.id)}">${CHECK_SVG}<span>${isRead(s.id) ? "読んだ" : "読んだ印をつける"}</span></button>
      </div>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" type="button" data-tab="summary" aria-selected="${state.tab === "summary"}">要約とスクショ</button>
        <button class="tab" role="tab" type="button" data-tab="transcript" aria-selected="${state.tab === "transcript"}">文字起こし</button>
      </div>
      <div id="tabBody"></div>
    </div>`;
    renderTab(s);
  }
  function renderTab(s) {
    const body = $("#tabBody");
    if (state.tab === "summary") {
      body.innerHTML = `<div class="card"><div class="md">${s.summary ? md(s.summary) : '<p class="empty">要約がまだありません。</p>'}</div></div>`;
      return;
    }
    body.innerHTML = `<div class="card"><p class="status"><span class="spinner"></span>文字起こしを読み込み中…</p></div>`;
    getTranscript(s.id).then((t) => {
      if (state.view !== "detail" || state.current !== s.id || state.tab !== "transcript") return;
      body.innerHTML = t
        ? `<div class="card"><div class="toolbar" style="margin-bottom:10px"><span class="hint">${t.length.toLocaleString()}文字（自動字幕のため誤変換があります）</span><button class="btn small" type="button" id="copyT">コピー</button></div><div class="transcript" id="tText">${esc(t)}</div></div>`
        : `<div class="card"><p class="empty">この回の文字起こしはありません。</p></div>`;
      const cb = $("#copyT");
      if (cb) cb.onclick = async () => { try { await navigator.clipboard.writeText(t); cb.textContent = "コピーしました"; } catch { const r = document.createRange(); r.selectNodeContents($("#tText")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); cb.textContent = "選択しました"; } };
    }).catch(() => { body.innerHTML = `<div class="card"><p class="status err">文字起こしを読み込めませんでした。</p></div>`; });
  }

  function renderYear() {
    const year = +state.current;
    const list = state.sessions.filter((s) => s.year === year && s.kind !== "ex").sort((a, b) => b._key - a._key);
    const y = state.years.get(String(year));
    $("#main").innerHTML = `<div class="page">
      ${backBtn()}
      <div class="page-head"><div class="crumbs"><span>${list.length}本</span></div><h2>${year}年のまとめ</h2></div>
      <div class="card"><div class="md">${y ? md(y) : '<p class="empty">年間のまとめはまだありません。</p>'}</div></div>
      <div class="results">${list.map((s) => hitHtml(s, esc(leadOf(s.summary).slice(0, 140)), "")).join("")}</div>
    </div>`;
  }

  /* ---------- search ---------- */
  async function localSearch(q, withTranscripts) {
    const ts = terms(q);
    if (!ts.length) return [];
    const hits = [], byId = new Map();
    for (const s of state.sessions) {
      const plain = stripMd(s.summary);
      if (ts.every((t) => norm(`${s.title}\n${s.cohort}\n${plain}`).includes(t))) {
        const score = ts.reduce((a, t) => a + (norm(s.title).includes(t) ? 5 : 0) + (norm(plain).split(t).length - 1), 0);
        const h = { s, snip: snippet(plain, ts) || snippet(s.title || "", ts), src: "要約", score: score + 100 };
        hits.push(h); byId.set(s.id, h);
      }
    }
    if (withTranscripts) {
      const all = await loadAllTranscripts();
      for (const s of state.sessions) {
        const t = all[s.id]; if (!t) continue;
        const nt = norm(t);
        if (!ts.every((x) => nt.includes(x))) continue;
        const count = ts.reduce((a, x) => a + nt.split(x).length - 1, 0);
        const ex = byId.get(s.id);
        if (ex) { ex.extra = snippet(t, ts); ex.tCount = count; }
        else hits.push({ s, snip: snippet(t, ts), src: `文字起こし（${count}か所）`, score: count });
      }
    }
    for (const p of state.xposts) {
      const hay = `${p.author}\n${p.handle}\n${p.tags.join(" ")}\n${stripMd(p.memo)}\n${stripMd(p.text)}`;
      if (!ts.every((t) => norm(hay).includes(t))) continue;
      hits.push({ x: p, snip: snippet(hay.replace(/\n/g, " "), ts), score: 50 + ts.reduce((a, t) => a + norm(hay).split(t).length - 1, 0) });
    }
    return hits.sort((a, b) => b.score - a.score || (b.s && a.s ? b.s._key - a.s._key : 0));
  }
  async function renderResults() {
    const q = state.searchQuery;
    const withT = $("#incTranscript").checked;
    $("#main").innerHTML = `<div class="page">
      ${backBtn()}
      <div class="page-head"><div class="crumbs"><span>検索</span></div><h2>「${esc(q)}」</h2></div>
      <div class="results" id="results"><p class="status"><span class="spinner"></span>探しています…</p></div>
    </div>`;
    try {
      const hits = await localSearch(q, withT);
      if (state.view !== "results" || state.searchQuery !== q) return;
      $("#results").innerHTML = hits.length
        ? `<p class="hint" style="margin:0">${hits.length}件見つかりました${withT ? "（要約と文字起こし）" : "（要約のみ）"}。</p>` + hits.map((h) => h.x ? `<button class="hit" type="button" data-xpost="${h.x.id}"><span class="h"><span class="ym">${xDate(h.x.date)}</span><span class="chip x">X</span>${esc(h.x.author || h.x.handle || "X の投稿")}</span>${h.snip ? `<span class="snip">${h.snip}</span>` : ""}</button>` : hitHtml(h.s, (h.snip || "") + (h.extra ? `<br><span class="src">文字起こし（${h.tCount}か所）</span><br>${h.extra}` : ""), h.src)).join("")
        : `<p class="empty">「${esc(q)}」は見つかりませんでした。言葉を短くしてみてください。</p>`;
    } catch { $("#results").innerHTML = `<p class="status err">検索用のデータを読み込めませんでした。</p>`; }
  }

  /* ---------- lightbox ---------- */
  function openLightbox(src, cap) {
    const lb = $("#lb");
    lb.innerHTML = `<img src="${esc(src)}" alt="${esc(cap || "")}">${cap ? `<p>${esc(cap)}</p>` : ""}<button class="btn" type="button" id="lbClose">閉じる</button>`;
    lb.hidden = false;
    $("#lbClose").focus();
  }
  $("#lb").addEventListener("click", (e) => { if (e.target.id === "lb" || e.target.id === "lbClose") $("#lb").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lb").hidden = true; });

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const z = e.target.closest(".zoom");
    if (z) { openLightbox(z.dataset.src, z.dataset.cap); return; }
    const a = e.target.closest("[data-act]");
    if (a && a.dataset.act === "home") { go(""); return; }
    const o = e.target.closest("[data-open]");
    if (o) { go("s-" + o.dataset.open); return; }
    const y = e.target.closest("[data-year]");
    if (y) { go("y" + y.dataset.year); return; }
    const r = e.target.closest("[data-read]");
    if (r) {
      e.preventDefault();
      toggleRead(r.dataset.read);
      renderIndex();
      const b = document.querySelector(".readbtn");
      if (b) {
        const rd = isRead(b.dataset.read);
        b.classList.toggle("is-read", rd); b.setAttribute("aria-pressed", String(rd));
        b.querySelector("span").textContent = rd ? "読んだ" : "読んだ印をつける";
      }
      return;
    }
    const xp = e.target.closest("[data-xplay]");
    if (xp) { playX(xp); return; }
    const xpost = e.target.closest("[data-xpost]");
    if (xpost) { state.xFocus = xpost.dataset.xpost; go("x"); return; }
    const xt = e.target.closest("[data-xtag]");
    if (xt) { state.searchQuery = xt.dataset.xtag; $("#q").value = xt.dataset.xtag; go("results"); return; }
    const c = e.target.closest("[data-cat]");
    if (c) {
      if (c.dataset.cat === "x") { state.xMonth = null; go("x"); return; }
      if (state.view === "x") { state.category = c.dataset.cat; go(""); return; }
      state.category = c.dataset.cat;
      document.querySelectorAll("#catTabs .tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === state.category)));
      renderIndex();
      return;
    }
    const t = e.target.closest("[data-tab]");
    if (t) {
      state.tab = t.dataset.tab;
      document.querySelectorAll(".tab[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
      const s = state.byId.get(state.current); if (s) renderTab(s);
    }
  });
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) { state.searchQuery = q; go("results"); } });
  window.addEventListener("hashchange", route);

  renderMain();
  loadCatalog();
})();
