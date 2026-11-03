// Panel web de administración: GET /admin (HTML) y GET /admin/app.js.
// Entra con la contraseña ADMIN_PASSWORD (secreto del Worker) y usa las mismas
// rutas /api/admin/* que el launcher, con un token de sesión web.

export const ADMIN_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Obsidia Eventos · Admin</title>
<style>
  :root {
    --bg: #0b0a10; --surface: #14121c; --surface-2: #1c1927; --border: #2a2638; --border-strong: #3a3550;
    --text: #ece9f5; --muted: #9a94ad; --accent: #8b5cf6; --accent-hover: #a78bfa; --danger: #ff8a8a; --ok: #7ee2a8;
    --radius: 10px;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .mono { font-family: ui-monospace, "JetBrains Mono", Consolas, monospace; }
  button, input, select, textarea { font: inherit; color: inherit; }
  input, select, textarea {
    width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface-2); outline: none;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); }
  textarea { resize: vertical; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px;
    border: 1px solid var(--border-strong); background: var(--surface-2); cursor: pointer; font-weight: 600; white-space: nowrap;
  }
  .btn:hover { border-color: var(--accent); }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.primary:hover { background: var(--accent-hover); }
  .btn.danger { color: var(--danger); }
  .btn.sm { padding: 5px 10px; font-size: 13px; }
  .hint { color: var(--muted); font-size: 13px; margin: 0; }
  .eyebrow { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .16em; color: var(--accent-hover); margin: 0; }
  h1, h2, h3 { margin: 0; }
  [hidden] { display: none !important; }

  .login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
  .login form { width: min(380px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 26px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px; }

  header.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px;
    border-bottom: 1px solid var(--border); background: var(--surface); }
  .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 60px); }
  aside { border-right: 1px solid var(--border); padding: 16px 12px; display: flex; flex-direction: column; gap: 6px; }
  .list-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .item { text-align: left; padding: 10px 12px; border-radius: 8px; border: 1px solid transparent; background: none; cursor: pointer; }
  .item:hover, .item.current { background: var(--surface-2); }
  .item.current { border-color: var(--border-strong); }
  .item strong { display: block; }
  .item span { color: var(--muted); font-size: 12px; }
  .tag { font-size: 11px; padding: 1px 6px; border-radius: 6px; background: #3a1f1f; color: var(--danger); margin-left: 4px; }
  main { padding: 22px 26px; min-width: 0; }
  .empty { display: grid; place-items: center; text-align: center; gap: 8px; padding: 60px 10px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 18px; }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .wide { grid-column: 1 / -1; }
  label.field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; }
  label.field .hint { font-weight: 400; display: inline; }
  label.check { display: flex; gap: 8px; align-items: center; font-size: 13px; }
  label.check input { width: auto; }
  .actions { display: flex; gap: 10px; margin-top: 16px; }
  .add { display: flex; gap: 10px; }
  .add textarea { flex: 1; }
  ul.players { list-style: none; margin: 12px 0 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); max-height: 460px; overflow-y: auto; }
  ul.players li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  ul.players li:last-child { border-bottom: none; }
  .p-name { font-weight: 600; min-width: 140px; }
  .p-uuid { flex: 1; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
  .x { width: 28px; height: 28px; border-radius: 7px; border: none; background: none; color: var(--muted); cursor: pointer; font-size: 15px; }
  .x:hover { background: rgb(255 80 80 / .12); color: var(--danger); }
  .filter { margin-top: 12px; }
  .toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 10; max-width: calc(100vw - 32px); }
  .toast { padding: 10px 14px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--border-strong); white-space: pre-line; max-width: 420px; }
  .toast.err { border-color: #6b2b2b; color: var(--danger); }
  .toast.ok { border-color: #245a3c; color: var(--ok); }

  @media (max-width: 760px) {
    .layout { grid-template-columns: 1fr; }
    aside { border-right: none; border-bottom: 1px solid var(--border); }
    main { padding: 16px; }
    .grid { grid-template-columns: 1fr; }
    .add { flex-direction: column; }
    .p-name { min-width: 0; }
  }
</style>
</head>
<body>
<section class="login" id="login" hidden>
  <form id="login-form">
    <div>
      <p class="eyebrow">Obsidia Eventos</p>
      <h2>Panel de organizadores</h2>
    </div>
    <label class="field">Contraseña de admin
      <input type="password" id="password" autocomplete="current-password" required>
    </label>
    <button class="btn primary" type="submit" id="login-btn">Entrar</button>
    <p class="hint">La contraseña es el secreto ADMIN_PASSWORD del servidor.</p>
  </form>
</section>

<div id="app" hidden>
  <header class="top">
    <div><p class="eyebrow">Obsidia Eventos</p><h3>Panel de organizadores</h3></div>
    <button class="btn sm" id="logout">Salir</button>
  </header>
  <div class="layout">
    <aside>
      <div class="list-head">
        <p class="eyebrow">Eventos</p>
        <button class="btn sm primary" id="new-event">+ Nuevo</button>
      </div>
      <div id="event-list"></div>
    </aside>
    <main>
      <div class="empty" id="empty">
        <h2>Elige un evento</h2>
        <p class="hint">Crea eventos y decide quién entra. Solo las cuentas de la whitelist ven el evento en el launcher.</p>
      </div>

      <div id="editor" hidden>
        <form class="card" id="event-form">
          <div class="card-head">
            <div><p class="eyebrow" id="event-id">Nuevo evento</p><h2 id="event-title">Sin nombre</h2></div>
            <button class="btn sm danger" type="button" id="delete-event" hidden>Borrar evento</button>
          </div>
          <div class="grid">
            <label class="field wide">Nombre <input name="name" maxlength="48" required placeholder="Torneo de invierno"></label>
            <label class="field wide">Descripción <span class="hint">(opcional)</span><textarea name="description" maxlength="600" rows="3"></textarea></label>
            <label class="field">Servidor de Minecraft <input name="server_address" class="mono" placeholder="mc.tuservidor.com:25565"></label>
            <label class="field">Pack del evento <span class="hint">(opcional)</span><input name="pack_code" class="mono" maxlength="10" placeholder="OBS-XXXXXX"></label>
            <label class="field nopack">Versión de Minecraft <input name="minecraft_version" class="mono" value="1.21.1"></label>
            <label class="field nopack">Loader
              <select name="loader"><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option></select>
            </label>
            <label class="field nopack fabric-only">Versión de Fabric Loader <span class="hint" id="fabric-hint"></span>
              <input name="loader_version" class="mono" placeholder="0.16.5" list="fabric-versions">
              <datalist id="fabric-versions"></datalist>
            </label>
            <label class="field">Memoria máxima (MB) <input name="memory_max" type="number" min="1024" step="512" value="4096"></label>
            <label class="field wide">Imagen <span class="hint">(https, opcional)</span><input name="image_url" class="mono" placeholder="https://…/portada.jpg"></label>
            <label class="check wide"><input type="checkbox" name="active" checked> Abierto: los jugadores de la whitelist lo ven y pueden jugar</label>
          </div>
          <div class="actions"><button class="btn primary" type="submit" id="save">Crear evento</button></div>
        </form>

        <section class="card" id="whitelist" hidden>
          <div class="card-head">
            <div><p class="eyebrow">Whitelist</p><h3 id="wl-count">0 jugadores con acceso</h3></div>
            <button class="btn sm" id="copy-names" type="button">Copiar nombres</button>
          </div>
          <div class="add">
            <textarea id="players-input" rows="2" placeholder="Nombres de Minecraft o UUIDs, separados por comas o saltos de línea"></textarea>
            <button class="btn primary" id="add-players" type="button">+ Añadir</button>
          </div>
          <p class="hint" style="margin-top:6px">Enter para añadir · Shift+Enter para otra línea.</p>
          <input class="filter" id="filter" placeholder="Buscar en la whitelist…" hidden>
          <ul class="players" id="players"></ul>
        </section>
      </div>
    </main>
  </div>
</div>
<div class="toasts" id="toasts"></div>
<script src="/admin/app.js"></script>
</body>
</html>`;

export const ADMIN_JS = `"use strict";
const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "obsidia-eventos-admin";
let token = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch {}
let events = [];
let openId = null; // null = nada, "new" = creando

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 7000 : 3000);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/admin/web-login") { logout(); throw new Error("La sesión ha caducado; vuelve a entrar."); }
  if (!res.ok) throw new Error(data.error || "Error " + res.status);
  return data;
}

function showLogin() { $("login").hidden = false; $("app").hidden = true; $("password").focus(); }
function logout() {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  showLogin();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-btn").disabled = true;
  try {
    const r = await api("POST", "/api/admin/web-login", { password: $("password").value });
    token = r.token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
    $("password").value = "";
    await start();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("login-btn").disabled = false;
  }
});
$("logout").addEventListener("click", logout);

async function start() {
  try {
    events = (await api("GET", "/api/admin/events")).events;
  } catch (err) {
    if (token) toast(err.message, "err");
    return;
  }
  $("login").hidden = true;
  $("app").hidden = false;
  renderList();
  if (openId && openId !== "new" && !current()) openId = null;
  renderEditor();
}

const current = () => events.find((e) => e.id === openId) || null;

function renderList() {
  const box = $("event-list");
  box.replaceChildren();
  if (events.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Todavía no hay eventos. Crea el primero.";
    box.appendChild(p);
  }
  for (const ev of events) {
    const b = document.createElement("button");
    b.className = "item" + (ev.id === openId ? " current" : "");
    const s = document.createElement("strong");
    s.textContent = ev.name;
    const m = document.createElement("span");
    m.textContent = (ev.players || []).length + " jugadores · " + ev.minecraft_version;
    if (!ev.active) { const t = document.createElement("span"); t.className = "tag"; t.textContent = "Cerrado"; m.appendChild(t); }
    b.append(s, m);
    b.addEventListener("click", () => { openId = ev.id; renderList(); renderEditor(); });
    box.appendChild(b);
  }
}

const form = $("event-form");
function updateVisibility() {
  const usesPack = form.pack_code.value.trim() !== "";
  for (const el of form.querySelectorAll(".nopack")) el.hidden = usesPack;
  form.querySelector(".fabric-only").hidden = usesPack || form.loader.value !== "fabric";
}
form.pack_code.addEventListener("input", updateVisibility);
form.loader.addEventListener("change", () => { updateVisibility(); fillFabric(); });

// Versión de Fabric Loader automática: la última estable para esa versión de
// Minecraft. Solo pisa el campo si está vacío o lo rellenó esto mismo.
let fabricAuto = false;
let fabricTimer = null;
let fabricSeq = 0;
form.loader_version.addEventListener("input", () => { fabricAuto = false; });
form.minecraft_version.addEventListener("input", () => {
  clearTimeout(fabricTimer);
  fabricTimer = setTimeout(fillFabric, 500);
});
async function fillFabric() {
  if (form.loader.value !== "fabric" || form.pack_code.value.trim() !== "") return;
  const mc = form.minecraft_version.value.trim();
  const hint = $("fabric-hint");
  const list = $("fabric-versions");
  if (!mc) return;
  const seq = ++fabricSeq;
  hint.textContent = "(buscando…)";
  try {
    const res = await fetch("https://meta.fabricmc.net/v2/versions/loader/" + encodeURIComponent(mc));
    const data = res.ok ? await res.json() : [];
    if (seq !== fabricSeq) return;
    list.replaceChildren();
    if (!Array.isArray(data) || data.length === 0) {
      hint.textContent = "(Fabric no tiene la " + mc + ")";
      return;
    }
    for (const x of data.slice(0, 20)) {
      const o = document.createElement("option");
      o.value = x.loader.version;
      if (x.loader.stable) o.label = "estable";
      list.appendChild(o);
    }
    const best = (data.find((x) => x.loader.stable) || data[0]).loader.version;
    if (!form.loader_version.value.trim() || fabricAuto) {
      form.loader_version.value = best;
      fabricAuto = true;
    }
    hint.textContent = "(última estable para " + mc + ": " + best + ")";
  } catch {
    if (seq === fabricSeq) hint.textContent = "(no se pudo consultar Fabric; escríbela a mano)";
  }
}
form.name.addEventListener("input", () => { $("event-title").textContent = form.name.value || "Sin nombre"; });

function renderEditor() {
  const ev = current();
  $("empty").hidden = openId !== null;
  $("editor").hidden = openId === null;
  if (openId === null) return;
  $("event-id").textContent = ev ? ev.id : "Nuevo evento";
  $("event-title").textContent = ev ? ev.name : "Sin nombre";
  $("delete-event").hidden = !ev;
  $("save").textContent = ev ? "Guardar cambios" : "Crear evento";
  form.name.value = ev ? ev.name : "";
  form.description.value = ev ? ev.description || "" : "";
  form.server_address.value = ev ? ev.server_address || "" : "";
  form.pack_code.value = ev ? ev.pack_code || "" : "";
  form.minecraft_version.value = ev ? ev.minecraft_version : "1.21.1";
  form.loader.value = ev ? ev.loader : "vanilla";
  form.loader_version.value = ev ? ev.loader_version || "" : "";
  form.memory_max.value = ev && ev.memory ? ev.memory.max_mb : ev ? "" : "4096";
  form.image_url.value = ev ? ev.image_url || "" : "";
  form.active.checked = ev ? ev.active : true;
  updateVisibility();
  fabricAuto = false;
  $("fabric-hint").textContent = "";
  fillFabric();
  $("whitelist").hidden = !ev;
  $("filter").value = "";
  renderPlayers();
}

function eventInput() {
  const t = (v) => v.trim() || null;
  const usesPack = form.pack_code.value.trim() !== "";
  const max = Number(form.memory_max.value);
  const loader = form.loader.value;
  return {
    name: form.name.value.trim(),
    description: t(form.description.value),
    server_address: t(form.server_address.value),
    image_url: t(form.image_url.value),
    pack_code: usesPack ? form.pack_code.value.trim().toUpperCase() : null,
    minecraft_version: usesPack ? null : t(form.minecraft_version.value),
    loader: usesPack ? null : loader,
    loader_version: usesPack || loader === "vanilla" ? null : t(form.loader_version.value),
    memory: max > 0 ? { min_mb: Math.min(2048, max), max_mb: max } : null,
    active: form.active.checked,
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("save").disabled = true;
  try {
    const ev = current();
    const saved = ev
      ? await api("PUT", "/api/admin/events/" + ev.id, eventInput())
      : await api("POST", "/api/admin/events", eventInput());
    const i = events.findIndex((x) => x.id === saved.id);
    if (i >= 0) events[i] = saved; else events.unshift(saved);
    openId = saved.id;
    renderList();
    renderEditor();
    toast(ev ? "Evento guardado" : "Evento creado. Ahora añade a los jugadores abajo.", "ok");
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("save").disabled = false;
  }
});

$("delete-event").addEventListener("click", async () => {
  const ev = current();
  if (!ev || !confirm("¿Borrar «" + ev.name + "» y su whitelist? No se puede deshacer.")) return;
  try {
    await api("DELETE", "/api/admin/events/" + ev.id);
    events = events.filter((x) => x.id !== ev.id);
    openId = null;
    renderList();
    renderEditor();
    toast("Evento borrado", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

$("new-event").addEventListener("click", () => { openId = "new"; renderList(); renderEditor(); form.name.focus(); });

function renderPlayers() {
  const ev = current();
  const list = $("players");
  list.replaceChildren();
  if (!ev) return;
  const players = ev.players || [];
  $("wl-count").textContent = players.length + (players.length === 1 ? " jugador con acceso" : " jugadores con acceso");
  $("filter").hidden = players.length <= 8;
  $("copy-names").disabled = players.length === 0;
  const f = $("filter").value.trim().toLowerCase();
  const shown = players.filter((p) => !f || p.name.toLowerCase().includes(f) || p.uuid.includes(f));
  if (shown.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = players.length ? "Nadie coincide con la búsqueda." : "Nadie todavía. Añade a los participantes arriba.";
    list.appendChild(li);
  }
  for (const p of shown) {
    const li = document.createElement("li");
    const n = document.createElement("span"); n.className = "p-name"; n.textContent = p.name;
    const u = document.createElement("span"); u.className = "p-uuid mono"; u.textContent = p.uuid;
    const x = document.createElement("button"); x.className = "x"; x.title = "Quitar de la whitelist"; x.textContent = "✕";
    x.addEventListener("click", async () => {
      try {
        ev.players = (await api("DELETE", "/api/admin/events/" + ev.id + "/players/" + p.uuid)).players;
        renderPlayers();
        renderList();
      } catch (err) { toast(err.message, "err"); }
    });
    li.append(n, u, x);
    list.appendChild(li);
  }
}
$("filter").addEventListener("input", renderPlayers);

async function addPlayers() {
  const ev = current();
  if (!ev) return;
  const queries = $("players-input").value.split(/[\\s,;]+/).map((q) => q.trim()).filter(Boolean);
  if (queries.length === 0) return;
  const btn = $("add-players");
  btn.disabled = true;
  btn.textContent = "Buscando…";
  const found = [];
  const failed = [];
  for (const q of queries) {
    try { found.push(await api("GET", "/api/admin/resolve?q=" + encodeURIComponent(q))); }
    catch (err) { failed.push({ q, msg: err.message }); }
  }
  try {
    if (found.length) {
      ev.players = (await api("POST", "/api/admin/events/" + ev.id + "/players", { players: found })).players;
      toast(found.length + " jugador(es) añadidos a la whitelist", "ok");
    }
    $("players-input").value = failed.map((f) => f.q).join("\\n");
    if (failed.length) toast("No se encontraron:\\n" + failed.map((f) => f.q + ": " + f.msg).join("\\n"), "err");
    renderPlayers();
    renderList();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Añadir";
  }
}
$("add-players").addEventListener("click", addPlayers);
$("players-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addPlayers(); }
});

$("copy-names").addEventListener("click", async () => {
  const ev = current();
  if (!ev) return;
  try { await navigator.clipboard.writeText(ev.players.map((p) => p.name).join("\\n")); toast("Copiado", "ok"); }
  catch { toast("No se pudo copiar", "err"); }
});

if (token) start().then(() => { if ($("app").hidden) showLogin(); }); else showLogin();
`;
