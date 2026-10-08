/* MENSAJES ALL · ALL CLEANING
 * Frontend sin build. Solo usa la publishable key de Supabase (vía /api/config).
 * Los envíos a WhatsApp pasan siempre por /api/send-message (servidor). */
(() => {
  "use strict";

  // ---------- constantes ----------
  const ASSETS = {
    logo: "/public/assets/logo-placeholder.svg",
    product: "/public/assets/product-placeholder.svg",
    fuxi: "/public/assets/fuxi-placeholder.svg"
  };
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const STATUS_LABEL = { open: "Abierta", pending: "Pendiente", closed: "Cerrada" };
  const DEFAULT_QUICK = [{
    id: "default-fucsia",
    title: "DESMANCHADOR FUCSIA",
    body: "hola!! espero que estés bien , el desmanchador fucsia vale $80.000 el galón y $ 40.000 el litro, el valor del envió es de $14.000 si es pago anticipado y si es contra entrega valdría $19.000. ( para algunas ciudades el precio de envió cambia) normalmente llega en 4 o 5 días hábiles a tu dirección también esto depende de tu ubicación. si deseas hacer el pedido me das nombre completo, dirección, ciudad, teléfono, cantidad del producto (litro o galón) y si es pago contra entrega o anticipado."
  }];
  const EMOJIS = "😀 😊 😉 😍 🥰 😂 🙏 👍 👏 🙌 💪 🎉 ✨ 🩷 💖 💚 🔥 ⭐ 👌 🤝 😅 🤗 😎 🤔 📦 🚚 🧴 🧽 🧼 🏠 ✅ ❌ ⏰ 📍 📞 💬 👋 🙂 😇 🥳".split(" ");

  // ---------- utilidades ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function formatPhone(n) {
    const d = String(n || "").replace(/\D/g, "");
    if (!d) return "Sin número";
    if (d.length === 12 && d.startsWith("57")) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    return `+${d}`;
  }
  const colorFor = (s) => {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 48%)`;
  };
  const initials = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length || /^\+?\d/.test(parts[0])) return "#";
    return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
  };
  const avatar = (contact, cls = "") => {
    const seed = contact?.whatsapp_number || contact?.id || "x";
    return `<div class="avatar ${cls}" style="background:${colorFor(seed)}">${esc(initials(contact?.name))}</div>`;
  };
  const displayName = (c) => (c?.name && c.name.trim()) || formatPhone(c?.whatsapp_number);

  const fmtTime = (d) => new Date(d).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  function relTime(iso) {
    if (!iso) return "";
    const d = new Date(iso), diff = Date.now() - d.getTime(), m = Math.floor(diff / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return `${m} min`;
    const sameDay = d.toDateString() === new Date().toDateString();
    if (sameDay) return fmtTime(d);
    if (diff < 2 * 86400000) return "ayer";
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  }
  function ago(iso) {
    if (!iso) return "";
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "Hace un momento";
    if (m < 60) return `Hace ${m} min`;
    if (m < 1440) return `Hace ${Math.floor(m / 60)} h`;
    return `Hace ${Math.floor(m / 1440)} d`;
  }
  const dayLabel = (iso) => {
    const d = new Date(iso), t = new Date();
    if (d.toDateString() === t.toDateString()) return "Hoy";
    const y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Ayer";
    return d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  };
  const TYPE_LABEL = { image: "📷 Imagen", audio: "🎤 Audio", video: "🎥 Video", document: "📄 Documento", sticker: "Sticker", location: "📍 Ubicación", contacts: "👤 Contacto", button: "Botón", interactive: "Respuesta interactiva", reaction: "Reacción" };
  const previewOf = (m) => (m ? (m.message_text || TYPE_LABEL[m.message_type] || "Mensaje") : "Sin mensajes");
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function toast(text, kind = "info", ms = 3500) {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  const migrationHint = (err) =>
    err && (err.code === "42703" || err.code === "PGRST204" || /column .* does not exist|schema cache/i.test(err.message || ""))
      ? "Falta ejecutar la migración SQL (columnas nuevas)."
      : null;

  // ---------- estado ----------
  const state = {
    sb: null, config: null, session: null,
    conversations: new Map(), contacts: new Map(), lastMsg: new Map(),
    messages: [], selectedId: null,
    filter: "all", search: "", contactSearch: "",
    quick: DEFAULT_QUICK, view: "inbox", realtime: "connecting",
    loadingList: true, booted: false
  };

  // ---------- arranque ----------
  async function boot() {
    $$("[data-asset]").forEach((img) => { img.src = ASSETS[img.dataset.asset]; });

    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.config = await res.json();
    } catch (e) {
      return fatal("No se pudo contactar el servidor. Revisa tu conexión e inténtalo de nuevo.");
    }

    if (!state.config.supabaseUrl || !state.config.supabaseKey) {
      return fatal("Faltan las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en Vercel.");
    }
    if (!window.supabase) return fatal("No se pudo cargar la librería de Supabase.");

    state.sb = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseKey);

    state.sb.auth.onAuthStateChange((event, session) => {
      const had = !!state.session;
      state.session = session;
      if (event === "SIGNED_OUT") { teardown(); showLogin(); }
      else if (session && !had && state.booted) enterApp();
    });

    const { data } = await state.sb.auth.getSession();
    state.session = data.session;
    state.booted = true;
    data.session ? enterApp() : showLogin();
  }

  function fatal(msg) {
    $("#boot").hidden = true; $("#login").hidden = true; $("#app").hidden = true;
    $("#fatalMsg").textContent = msg;
    $("#fatal").hidden = false;
  }
  function showLogin() {
    $("#boot").hidden = true; $("#app").hidden = true; $("#fatal").hidden = true;
    $("#login").hidden = false;
  }

  // ---------- login ----------
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn"), err = $("#loginError");
    err.hidden = true; btn.disabled = true; btn.textContent = "Entrando…";
    const { error } = await state.sb.auth.signInWithPassword({
      email: $("#loginEmail").value.trim(),
      password: $("#loginPassword").value
    });
    btn.disabled = false; btn.textContent = "Entrar";
    if (error) {
      err.textContent = /invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : `No se pudo iniciar sesión: ${error.message}`;
      err.hidden = false;
    }
  });
  $("#logoutBtn").addEventListener("click", () => state.sb.auth.signOut());

  function teardown() {
    if (state.channel) { state.sb.removeChannel(state.channel); state.channel = null; }
    state.conversations.clear(); state.contacts.clear(); state.lastMsg.clear();
    state.messages = []; state.selectedId = null; state.loadingList = true;
  }

  // ---------- app ----------
  async function enterApp() {
    $("#boot").hidden = true; $("#login").hidden = true; $("#fatal").hidden = true;
    $("#app").hidden = false;
    $("#userEmail").textContent = state.session?.user?.email || "";
    $("#loginPassword").value = "";
    setConn();
    renderList();
    await Promise.all([loadData(), loadQuick()]);
    subscribe();
    renderAll();
  }

  async function loadData() {
    const sb = state.sb;
    const [c, k, m] = await Promise.all([
      sb.from("conversations").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(500),
      sb.from("contacts").select("*").limit(2000),
      sb.from("messages").select("id,conversation_id,direction,message_type,message_text,timestamp,status,sent_by")
        .order("timestamp", { ascending: false }).limit(400)
    ]);
    for (const r of [c, k, m]) if (r.error) { console.error(r.error); toast(`Error cargando datos: ${r.error.message}`, "err", 6000); }
    state.conversations = new Map((c.data || []).map((x) => [x.id, x]));
    state.contacts = new Map((k.data || []).map((x) => [x.id, x]));
    state.lastMsg = new Map();
    for (const msg of m.data || []) if (!state.lastMsg.has(msg.conversation_id)) state.lastMsg.set(msg.conversation_id, msg);
    state.recent = m.data || [];
    state.loadingList = false;
  }

  async function loadQuick() {
    const { data, error } = await state.sb.from("quick_replies").select("*").order("created_at");
    if (!error && data?.length) state.quick = data;
    else state.quick = DEFAULT_QUICK;
  }

  // ---------- tiempo real ----------
  function subscribe() {
    const sb = state.sb;
    state.channel = sb.channel("mensajes-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, onMessage)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, onConversation)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, onContact)
      .subscribe((status) => {
        state.realtime = status === "SUBSCRIBED" ? "ok" : (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") ? "bad" : "connecting";
        setConn();
      });
  }

  function setConn() {
    const pill = $("#connPill"), txt = $("#connText");
    let cls = "warn", text = "Conectando…";
    if (state.realtime === "bad") { cls = "bad"; text = "Problema de conexión"; }
    else if (state.config && !state.config.whatsappConfigured) { cls = "warn"; text = "WhatsApp sin configurar"; }
    else if (state.realtime === "ok") { cls = "ok"; text = "WhatsApp conectado"; }
    pill.className = `pill ${cls}`; txt.textContent = text;
  }
  window.addEventListener("offline", () => { state.realtime = "bad"; setConn(); });

  async function onMessage(payload) {
    const m = payload.new;
    if (!m?.id) return;
    if (payload.eventType === "INSERT") {
      const prev = state.lastMsg.get(m.conversation_id);
      if (!prev || new Date(m.timestamp) >= new Date(prev.timestamp)) state.lastMsg.set(m.conversation_id, m);
      state.recent = [m, ...(state.recent || []).filter((x) => x.id !== m.id)].slice(0, 400);
      if (!state.conversations.has(m.conversation_id)) await fetchConversation(m.conversation_id);
      if (m.conversation_id === state.selectedId) {
        if (!state.messages.some((x) => x.id === m.id)) { state.messages.push(m); renderMessages({ stick: true }); }
        if (m.direction === "incoming") markRead(m.conversation_id);
      } else if (m.direction === "incoming") {
        const c = state.contacts.get(state.conversations.get(m.conversation_id)?.contact_id);
        toast(`💬 ${displayName(c)}: ${previewOf(m).slice(0, 60)}`, "info");
      }
    } else if (payload.eventType === "UPDATE") {
      const i = state.messages.findIndex((x) => x.id === m.id);
      if (i >= 0) { state.messages[i] = { ...state.messages[i], ...m }; renderMessages(); }
      const lm = state.lastMsg.get(m.conversation_id);
      if (lm?.id === m.id) state.lastMsg.set(m.conversation_id, { ...lm, ...m });
    }
    renderList(); renderUnread(); renderDashboardIfVisible();
    if (state.selectedId === m.conversation_id) renderChatHead();
  }

  async function fetchConversation(id) {
    const { data } = await state.sb.from("conversations").select("*").eq("id", id).maybeSingle();
    if (data) {
      state.conversations.set(id, data);
      if (!state.contacts.has(data.contact_id)) await fetchContact(data.contact_id);
    }
  }
  async function fetchContact(id) {
    const { data } = await state.sb.from("contacts").select("*").eq("id", id).maybeSingle();
    if (data) state.contacts.set(id, data);
  }

  async function onConversation(payload) {
    if (payload.eventType === "DELETE") { state.conversations.delete(payload.old?.id); }
    else {
      const c = payload.new;
      state.conversations.set(c.id, c);
      if (!state.contacts.has(c.contact_id)) await fetchContact(c.contact_id);
    }
    renderList(); renderUnread(); renderDashboardIfVisible();
    if (payload.new?.id === state.selectedId) { renderChatHead(); if (!infoFocused()) renderInfo(); }
  }
  function onContact(payload) {
    if (payload.new) state.contacts.set(payload.new.id, payload.new);
    renderList(); renderContactsIfVisible();
    const sel = state.conversations.get(state.selectedId);
    if (sel && payload.new?.id === sel.contact_id) { renderChatHead(); if (!infoFocused()) renderInfo(); }
  }
  const infoFocused = () => $("#info").contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);

  // ---------- navegación ----------
  $$(".tab").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  function setView(v) {
    state.view = v;
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    for (const name of ["inbox", "contacts", "dashboard"]) $(`#view-${name}`).hidden = name !== v;
    if (v === "contacts") renderContacts();
    if (v === "dashboard") renderDashboard();
  }

  // ---------- lista de conversaciones ----------
  $("#search").addEventListener("input", debounce((e) => { state.search = e.target.value.trim().toLowerCase(); renderList(); }, 120));
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    state.filter = b.dataset.filter;
    $$("#filters .chip").forEach((c) => c.classList.toggle("active", c === b));
    renderList();
  });

  function filteredConversations() {
    let list = [...state.conversations.values()];
    if (state.filter === "unread") list = list.filter((c) => (c.unread_count || 0) > 0);
    else if (state.filter !== "all") list = list.filter((c) => c.status === state.filter);
    if (state.search) {
      list = list.filter((c) => {
        const ct = state.contacts.get(c.contact_id);
        return `${ct?.name || ""} ${ct?.whatsapp_number || ""}`.toLowerCase().includes(state.search);
      });
    }
    return list.sort((a, b) => new Date(b.last_message_at || b.created_at || 0) - new Date(a.last_message_at || a.created_at || 0));
  }

  function renderList() {
    const box = $("#convList");
    if (state.loadingList) {
      box.innerHTML = Array.from({ length: 6 }, () => '<div class="skel"><i></i><i></i><i></i></div>').join("");
      return;
    }
    const list = filteredConversations();
    if (!list.length) {
      box.innerHTML = `<div class="empty-list">${state.conversations.size ? "No hay conversaciones con ese filtro." : "Aún no hay conversaciones."}</div>`;
      return;
    }
    box.innerHTML = list.map((c) => {
      const ct = state.contacts.get(c.contact_id), lm = state.lastMsg.get(c.id), unread = c.unread_count || 0;
      const mine = lm?.direction === "outgoing" ? (lm.sent_by === "automatic" ? "🤖 " : "Tú: ") : "";
      return `<div class="conv ${c.id === state.selectedId ? "active" : ""} ${unread ? "unread" : ""}" data-id="${esc(c.id)}" role="button" tabindex="0">
        ${avatar(ct)}
        <div class="main">
          <span class="name">${esc(displayName(ct))}</span>
          <span class="preview">${esc(mine + previewOf(lm))}</span>
        </div>
        <div class="meta">
          <span>${esc(relTime(c.last_message_at))}</span>
          ${unread ? `<span class="badge">${unread}</span>` : `<span class="status-tag status-${esc(c.status)}">${esc(STATUS_LABEL[c.status] || c.status || "")}</span>`}
        </div>
      </div>`;
    }).join("");
  }
  $("#convList").addEventListener("click", (e) => { const el = e.target.closest(".conv"); if (el) openConversation(el.dataset.id); });
  $("#convList").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.click?.(); });

  function renderUnread() {
    const total = [...state.conversations.values()].reduce((n, c) => n + ((c.unread_count || 0) > 0 ? 1 : 0), 0);
    const b = $("#unreadTotal");
    b.hidden = !total; b.textContent = total;
    document.title = total ? `(${total}) Mensajes ALL · ALL CLEANING` : "Mensajes ALL · ALL CLEANING";
  }

  // ---------- conversación ----------
  async function openConversation(id, { fromDashboard = false } = {}) {
    if (fromDashboard) setView("inbox");
    state.selectedId = id;
    state.messages = [];
    $("#view-inbox").dataset.pane = "chat";
    $("#view-inbox").classList.remove("info-open"); $("#infoScrim").hidden = true;
    $("#chatEmpty").hidden = true; $("#chat").hidden = false;
    renderList(); renderChatHead(); renderInfo();
    $("#messages").innerHTML = '<div class="empty-list">Cargando mensajes…</div>';

    const { data, error } = await state.sb.from("messages").select("*").eq("conversation_id", id)
      .order("timestamp", { ascending: true }).limit(500);
    if (state.selectedId !== id) return;
    if (error) { toast(`No se pudieron cargar los mensajes: ${error.message}`, "err"); return; }
    state.messages = data || [];
    renderMessages({ stick: true, instant: true });
    $("#input").focus({ preventScroll: true });
    markRead(id);
  }

  async function markRead(id) {
    const c = state.conversations.get(id);
    if (!c || !(c.unread_count > 0)) return;
    c.unread_count = 0; renderList(); renderUnread();
    const { error } = await state.sb.from("conversations").update({ unread_count: 0 }).eq("id", id);
    if (error) console.error("markRead", error);
  }

  $("#backBtn").addEventListener("click", () => { $("#view-inbox").dataset.pane = "list"; });
  $("#infoBtn").addEventListener("click", () => { $("#view-inbox").classList.add("info-open"); $("#infoScrim").hidden = false; });
  $("#infoScrim").addEventListener("click", () => { $("#view-inbox").classList.remove("info-open"); $("#infoScrim").hidden = true; });

  function lastIncomingTime() {
    for (let i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].direction === "incoming") return new Date(state.messages[i].timestamp).getTime();
    return 0;
  }
  const windowOpen = () => { const t = lastIncomingTime(); return t > 0 && Date.now() - t <= WINDOW_MS; };

  function renderChatHead() {
    const c = state.conversations.get(state.selectedId); if (!c) return;
    const ct = state.contacts.get(c.contact_id);
    $("#chatAvatar").outerHTML = avatar(ct).replace('class="avatar', 'id="chatAvatar" class="avatar');
    $("#chatName").textContent = displayName(ct);
    const dotColor = c.status === "closed" ? "var(--muted)" : c.status === "pending" ? "var(--gold)" : "var(--green)";
    $("#chatSub").innerHTML = `${esc(formatPhone(ct?.whatsapp_number))} · <i class="dot" style="background:${dotColor}"></i> ${esc(STATUS_LABEL[c.status] || c.status || "")}`;
  }

  function tickFor(m) {
    if (m.direction !== "outgoing") return "";
    if (m.status === "read") return '<span class="tick read" title="Leído">✓✓</span>';
    if (m.status === "delivered") return '<span class="tick" title="Entregado">✓✓</span>';
    if (m.status === "failed") return '<span class="tick failed" title="No se pudo enviar">⚠</span>';
    return '<span class="tick" title="Enviado">✓</span>';
  }

  function renderMessages({ stick = false, instant = false } = {}) {
    const box = $("#messages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prevTop = box.scrollTop;
    let html = "", lastDay = "";
    for (const m of state.messages) {
      const day = new Date(m.timestamp).toDateString();
      if (day !== lastDay) { html += `<div class="day">${esc(dayLabel(m.timestamp))}</div>`; lastDay = day; }
      const out = m.direction === "outgoing";
      const tag = out ? (m.sent_by === "automatic" ? '<span class="tag auto">🤖 Respuesta automática</span>' : '<span class="tag">👤 Agente</span>') : "";
      const body = m.message_text ? esc(m.message_text) : `<span class="nontext">${esc(TYPE_LABEL[m.message_type] || "Mensaje sin texto")}</span>`;
      html += `<div class="bubble-row ${out ? "out" : "in"}"><div class="bubble">${tag}${body}<span class="foot">${esc(fmtTime(m.timestamp))} ${tickFor(m)}</span></div></div>`;
    }
    box.innerHTML = html || '<div class="empty-list">Esta conversación aún no tiene mensajes.</div>';
    if (instant) box.style.scrollBehavior = "auto";
    if (stick && (nearBottom || instant)) box.scrollTop = box.scrollHeight;
    else if (stick) { box.scrollTop = prevTop; $("#newMsgBtn").hidden = false; }
    else box.scrollTop = prevTop;
    box.style.scrollBehavior = "";

    const open = windowOpen();
    $("#windowBanner").hidden = open || !state.messages.length;
    $("#composer").classList.toggle("disabled", !open && state.messages.length > 0);
    $("#input").disabled = !open && state.messages.length > 0;
  }
  $("#messages").addEventListener("scroll", (e) => {
    const b = e.target; if (b.scrollHeight - b.scrollTop - b.clientHeight < 80) $("#newMsgBtn").hidden = true;
  });
  $("#newMsgBtn").addEventListener("click", () => { const b = $("#messages"); b.scrollTop = b.scrollHeight; $("#newMsgBtn").hidden = true; });

  // ---------- composer ----------
  const input = $("#input");
  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
  });

  $("#composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim(), id = state.selectedId;
    if (!text || !id) return;
    const btn = $("#sendBtn"); btn.disabled = true;
    try {
      const { data: { session } } = await state.sb.auth.getSession();
      const res = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ conversation_id: id, text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "WINDOW_CLOSED") { $("#windowBanner").hidden = false; }
        toast(data.error || "No se pudo enviar el mensaje", "err", 6000);
        return;
      }
      input.value = ""; autosize();
      if (data.message && state.selectedId === id && !state.messages.some((m) => m.id === data.message.id)) {
        state.messages.push(data.message);
        state.lastMsg.set(id, data.message);
        renderMessages({ stick: true, instant: true }); renderList();
      }
      toast(data.warning || "Mensaje enviado", data.warning ? "info" : "ok", 2000);
    } catch (err) {
      toast("Problema de conexión al enviar el mensaje", "err");
    } finally { btn.disabled = false; input.focus(); }
  });

  // emoji y respuestas rápidas
  $("#emojiPop").innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join("");
  $("#emojiPop").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const s = input.selectionStart ?? input.value.length;
    input.setRangeText(b.textContent, s, input.selectionEnd ?? s, "end"); autosize(); input.focus();
  });
  const pops = { emojiBtn: "#emojiPop", quickBtn: "#quickPop" };
  Object.entries(pops).forEach(([btn, pop]) => $("#" + btn).addEventListener("click", (e) => {
    e.stopPropagation();
    const target = $(pop), was = target.hidden;
    closePops(); target.hidden = !was;
    if (pop === "#quickPop" && was) renderQuick();
  }));
  document.addEventListener("click", (e) => { if (!e.target.closest(".pop-wrap")) closePops(); });
  const closePops = () => Object.values(pops).forEach((p) => { $(p).hidden = true; });

  function renderQuick() {
    $("#quickPop").innerHTML =
      state.quick.map((q) => `<div class="qr" data-id="${esc(q.id)}"><b>⚡ ${esc(q.title)}</b><span>${esc(q.body)}</span></div>`).join("") +
      `<form class="qr-form" id="qrForm"><input name="title" placeholder="Título" required><textarea name="body" rows="2" placeholder="Texto de la respuesta" required></textarea><button class="btn small" type="submit">+ Guardar respuesta rápida</button></form>`;
  }
  $("#quickPop").addEventListener("click", (e) => {
    const el = e.target.closest(".qr"); if (!el) return;
    const q = state.quick.find((x) => String(x.id) === el.dataset.id); if (!q) return;
    input.value = q.body; autosize(); closePops(); input.focus();   // solo carga el texto; NO envía
  });
  $("#quickPop").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, title = f.title.value.trim(), body = f.body.value.trim();
    const { error } = await state.sb.from("quick_replies").insert({ title, body });
    if (error) return toast(/does not exist|schema cache/i.test(error.message) ? "Falta ejecutar la migración SQL (quick_replies)." : error.message, "err", 5000);
    await loadQuick(); renderQuick(); toast("Respuesta rápida guardada", "ok");
  });

  // ---------- panel del cliente ----------
  function renderInfo() {
    const c = state.conversations.get(state.selectedId), box = $("#info");
    if (!c) { box.innerHTML = ""; return; }
    const ct = state.contacts.get(c.contact_id) || {}, od = c.order_data || {};
    const tags = Array.isArray(ct.tags) ? ct.tags : [];
    const opt = (v, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${STATUS_LABEL[v]}</option>`;
    box.innerHTML = `
      <div class="info-head">${avatar(ct, "lg")}<strong>${esc(displayName(ct))}</strong><span class="muted small">${esc(formatPhone(ct.whatsapp_number))}</span></div>

      <div class="info-section"><h4>Información del cliente</h4>
        <label class="field"><span>Nombre</span><input id="f-name" value="${esc(ct.name)}" placeholder="Nombre completo"></label>
        <label class="field"><span>Teléfono</span><input value="${esc(formatPhone(ct.whatsapp_number))}" disabled></label>
        <label class="field"><span>Ciudad</span><input id="f-city" value="${esc(ct.city)}" placeholder="Ciudad"></label>
        <label class="field"><span>Dirección</span><input id="f-address" value="${esc(ct.address)}" placeholder="Dirección de entrega"></label>
        <label class="field"><span>Estado de la conversación</span>
          <select id="f-status">${opt("open", c.status)}${opt("pending", c.status)}${opt("closed", c.status)}</select></label>
      </div>

      <div class="info-section"><h4>Datos del pedido</h4>
        <label class="field"><span>Producto</span><input id="o-producto" value="${esc(od.producto)}" placeholder="Desmanchador Fucsia"></label>
        <div class="two">
          <label class="field"><span>Cantidad</span><input id="o-cantidad" inputmode="numeric" value="${esc(od.cantidad)}" placeholder="1"></label>
          <label class="field"><span>Presentación</span>
            <select id="o-presentacion"><option value="">—</option><option ${od.presentacion === "Litro" ? "selected" : ""}>Litro</option><option ${od.presentacion === "Galón" ? "selected" : ""}>Galón</option></select></label>
        </div>
        <label class="field"><span>Forma de pago</span>
          <select id="o-pago"><option value="">—</option><option ${od.pago === "Pago anticipado" ? "selected" : ""}>Pago anticipado</option><option ${od.pago === "Contra entrega" ? "selected" : ""}>Contra entrega</option></select></label>
      </div>

      <div class="info-section"><h4>Notas</h4>
        <textarea id="f-notes" rows="4" placeholder="Notas internas sobre el cliente…">${esc(ct.notes)}</textarea>
      </div>

      <div class="save-row"><button class="btn primary" id="saveInfo">Guardar cambios</button></div>

      ${tags.length ? `<div class="info-section" style="margin-top:20px"><h4>Etiquetas</h4><div class="tags">${tags.map((t) => `<span class="tag-chip">${esc(typeof t === "object" ? t.name : t)}</span>`).join("")}</div></div>` : ""}

      <div class="info-section" style="margin-top:20px"><h4>Referencia rápida</h4>
        <div class="product-card">
          <img data-asset="product" src="${ASSETS.product}" alt="Desmanchador Fucsia">
          <div><b>DESMANCHADOR FUCSIA</b>
            <dl><dt>1 litro</dt><dd>$40.000</dd><dt>1 galón</dt><dd>$80.000</dd>
            <dt>Envío anticipado</dt><dd>$14.000</dd><dt>Contra entrega</dt><dd>$19.000</dd></dl></div>
          <p class="note">Para algunas ciudades el valor del envío cambia.</p>
        </div>
      </div>`;
  }

  $("#info").addEventListener("click", async (e) => {
    if (e.target.id !== "saveInfo") return;
    const c = state.conversations.get(state.selectedId); if (!c) return;
    const btn = e.target; btn.disabled = true;
    const v = (id) => $("#" + id).value.trim();
    const order = { producto: v("o-producto"), cantidad: v("o-cantidad"), presentacion: v("o-presentacion"), pago: v("o-pago") };
    Object.keys(order).forEach((k) => { if (!order[k]) delete order[k]; });
    const now = new Date().toISOString();

    const r1 = await state.sb.from("contacts").update({
      name: v("f-name") || null, city: v("f-city") || null, address: v("f-address") || null, notes: v("f-notes") || null, updated_at: now
    }).eq("id", c.contact_id).select().single();
    const r2 = await state.sb.from("conversations").update({ status: v("f-status"), order_data: order, updated_at: now })
      .eq("id", c.id).select().single();
    btn.disabled = false;

    const err = r1.error || r2.error;
    if (err) return toast(migrationHint(err) || `No se pudo guardar: ${err.message}`, "err", 6000);
    state.contacts.set(r1.data.id, r1.data); state.conversations.set(r2.data.id, r2.data);
    renderList(); renderChatHead(); renderInfo();
    toast("Cambios guardados", "ok");
  });

  // ---------- contactos ----------
  $("#contactSearch").addEventListener("input", debounce((e) => { state.contactSearch = e.target.value.trim().toLowerCase(); renderContacts(); }, 120));
  const renderContactsIfVisible = () => { if (state.view === "contacts") renderContacts(); };
  function renderContacts() {
    const q = state.contactSearch;
    const convByContact = new Map([...state.conversations.values()].map((c) => [c.contact_id, c]));
    const list = [...state.contacts.values()]
      .filter((c) => !q || `${c.name || ""} ${c.whatsapp_number || ""} ${c.city || ""}`.toLowerCase().includes(q))
      .sort((a, b) => displayName(a).localeCompare(displayName(b), "es"));
    $("#contactList").innerHTML = list.length ? list.map((c) => {
      const conv = convByContact.get(c.id);
      return `<div class="row" ${conv ? `data-conv="${esc(conv.id)}" style="cursor:pointer"` : ""}>
        ${avatar(c)}
        <div class="ellipsis"><b>${esc(displayName(c))}</b></div>
        <div class="ellipsis muted">${esc(formatPhone(c.whatsapp_number))}</div>
        <div class="ellipsis muted hide-sm">${esc([c.city, c.address].filter(Boolean).join(" · ") || "—")}</div>
        <span class="muted small">${conv ? esc(relTime(conv.last_message_at)) : ""}</span></div>`;
    }).join("") : '<div class="empty-list">No hay contactos todavía.</div>';
  }
  $("#contactList").addEventListener("click", (e) => { const r = e.target.closest("[data-conv]"); if (r) openConversation(r.dataset.conv, { fromDashboard: true }); });

  // ---------- dashboard ----------
  const renderDashboardIfVisible = () => { if (state.view === "dashboard") renderDashboard(); };
  function renderDashboard() {
    const convs = [...state.conversations.values()];
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const today = convs.filter((c) => c.last_message_at && new Date(c.last_message_at) >= startOfDay).length;
    const unread = convs.filter((c) => (c.unread_count || 0) > 0).length;
    const orders = convs.filter((c) => c.order_data && Object.keys(c.order_data).length).length;
    $("#stats").innerHTML = [
      ["CONVERSACIONES HOY", today, ""], ["NO LEÍDAS", unread, "pink"],
      ["CLIENTES", state.contacts.size, "green"], ["PEDIDOS", orders, ""]
    ].map(([l, n, k]) => `<div class="stat ${k}"><small>${l}</small><strong>${n}</strong></div>`).join("");

    const rows = (state.recent || []).slice(0, 8).map((m) => {
      const c = state.conversations.get(m.conversation_id), ct = state.contacts.get(c?.contact_id);
      const what = m.direction === "incoming" ? "Nuevo mensaje" : m.sent_by === "automatic" ? "Respuesta automática enviada" : "Respuesta enviada";
      return `<div class="act" data-conv="${esc(m.conversation_id)}"><div><b>${esc(displayName(ct))}</b><div class="muted small">${what}</div></div><span class="muted small">${esc(ago(m.timestamp))}</span></div>`;
    });
    $("#activity").innerHTML = rows.join("") || '<div class="empty-list">Todavía no hay actividad.</div>';
  }
  $("#activity").addEventListener("click", (e) => { const r = e.target.closest("[data-conv]"); if (r) openConversation(r.dataset.conv, { fromDashboard: true }); });

  function renderAll() { renderList(); renderUnread(); renderDashboardIfVisible(); }

  // refresca horas relativas sin consultar la red
  setInterval(() => { if (!$("#app").hidden) { renderList(); if (state.selectedId) renderMessages(); } }, 60000);

  boot();
})();
