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
  .image-field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; }
  .image-field .hint { font-weight: 400; }
  .image-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .image-row input { flex: 1 1 220px; min-width: 0; }
  #image-preview { width: 72px; height: 40px; object-fit: cover; border-radius: 7px; border: 1px solid var(--border); flex: none; }
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
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .mods { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border); }
  .mods .card-head { margin-bottom: 8px; }
  ul.modlist, ul.results { list-style: none; margin: 10px 0 0; padding: 0; }
  ul.modlist { border: 1px solid var(--border); border-radius: var(--radius); max-height: 420px; overflow-y: auto; }
  ul.modlist:empty { display: none; }
  ul.modlist li, ul.results li { display: flex; align-items: center; gap: 12px; padding: 8px 12px; }
  ul.modlist li { border-bottom: 1px solid var(--border); }
  ul.modlist li:last-child { border-bottom: none; }
  ul.results li { border-radius: 8px; }
  ul.results li:hover { background: var(--surface-2); }
  .ic { width: 32px; height: 32px; border-radius: 7px; background: var(--surface-2); flex: none; object-fit: cover; }
  .m-main { flex: 1; min-width: 0; }
  .m-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m-main span { display: block; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src { font-size: 11px; padding: 1px 7px; border-radius: 6px; background: var(--surface-2); color: var(--muted); flex: none; }
  .src.dep { color: var(--accent-hover); }
  .search { margin-top: 12px; }
  .actions { align-items: center; }
  .rank { font-size: 11px; font-weight: 650; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--muted); white-space: nowrap; flex: none; }
  .rank.owner { color: #ffd479; border-color: #6b5520; background: #2a2210; }
  .rank.developer { color: #7ec8ff; border-color: #24506e; background: #0f2130; }
  .rank.staff { color: var(--accent-hover); border-color: #4a3a80; background: #1d1733; }
  .rank.miembro { color: var(--ok); border-color: #245a3c; background: #0f2219; }
  select.rank-select { width: auto; padding: 4px 8px; font-size: 12px; flex: none; }
  .add select { width: auto; align-self: stretch; }
  .item.ranks-item { border-color: var(--border); margin-bottom: 8px; }
  .legend { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; align-items: center; margin: 0 0 16px; font-size: 13px; color: var(--muted); }
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
    <div class="row">
      <button class="btn sm danger" id="logout-all" title="Cierra el panel en todos los navegadores donde esté abierto">Cerrar todas las sesiones</button>
      <button class="btn sm" id="logout">Salir</button>
    </div>
  </header>
  <div class="layout">
    <aside>
      <button class="item ranks-item" id="open-ranks"><strong>Rangos</strong><span>Owner, Developer, Staff, Miembro, Invitado</span></button>
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

      <section class="card" id="ranks" hidden>
        <div class="card-head">
          <div><p class="eyebrow">Equipo</p><h2>Rangos</h2></div>
        </div>
        <div class="legend">
          <span class="rank owner">Owner</span><span>Todo, incluido dar cualquier rango. Desde este panel puedes cambiar el rango de cualquiera.</span>
          <span class="rank developer">Developer</span><span>Crear y editar eventos y mods, whitelist, dar rangos hasta Staff.</span>
          <span class="rank staff">Staff</span><span>Whitelist y dar Miembro o Invitado. Entra a todos los eventos.</span>
          <span class="rank miembro">Miembro</span><span>Juega los eventos en cuya whitelist está.</span>
          <span class="rank">Invitado</span><span>Igual que Miembro. Es el rango de quien no tiene ninguno.</span>
        </div>
        <div class="add">
          <textarea id="members-input" rows="2" placeholder="Nombres de Minecraft o UUIDs, separados por comas o saltos de línea"></textarea>
          <select id="members-rank"></select>
          <button class="btn primary" id="add-members" type="button">Dar rango</button>
        </div>
        <ul class="players" id="members"></ul>
      </section>

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
            <label class="field">Versión de Minecraft <input name="minecraft_version" class="mono" value="1.21.1"></label>
            <label class="field">Loader
              <select name="loader"><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option></select>
            </label>
            <label class="field fabric-only">Versión de Fabric Loader <span class="hint" id="fabric-hint"></span>
              <input name="loader_version" class="mono" placeholder="0.16.5" list="fabric-versions">
              <datalist id="fabric-versions"></datalist>
            </label>
            <label class="field">Memoria máxima (MB) <input name="memory_max" type="number" min="1024" step="512" value="4096"></label>
            <div class="image-field wide">
              <label for="image-url">Imagen de fondo <span class="hint">(PNG, JPG, WEBP o GIF de hasta 15 MB; opcional)</span></label>
              <div class="image-row">
                <img id="image-preview" alt="" hidden>
                <input id="image-url" name="image_url" class="mono" placeholder="Sube una foto o pega una URL https://…">
                <button class="btn sm" type="button" id="image-upload-btn">Subir foto</button>
                <button class="btn sm" type="button" id="image-clear" hidden>Quitar</button>
                <input type="file" id="image-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
              </div>
            </div>
            <label class="check wide"><input type="checkbox" name="active" checked> Abierto: los jugadores de la whitelist lo ven y pueden jugar</label>
          </div>
          <section class="mods" id="mods-section">
            <div class="card-head">
              <div><p class="eyebrow">Mods</p><h3 id="mods-count">Sin mods</h3></div>
              <div class="row">
                <button class="btn sm" type="button" id="update-mods" hidden>Actualizar a esta versión</button>
                <button class="btn sm" type="button" id="upload-btn">Subir .jar</button>
                <input type="file" id="upload-input" accept=".jar" multiple hidden>
              </div>
            </div>
            <p class="hint" id="mods-vanilla" hidden>Los mods necesitan Fabric: cambia el loader arriba.</p>
            <p class="hint">Se instalan solos al pulsar Jugar. Los mods que el jugador tenga y no estén aquí se borran.</p>
            <ul class="modlist" id="mod-list"></ul>
            <div class="search">
              <input id="mod-search" placeholder="Buscar mods en Modrinth (por ejemplo: sodium, voice chat…)" autocomplete="off">
              <ul class="results" id="mod-results"></ul>
            </div>
          </section>
          <div class="actions">
            <button class="btn primary" type="submit" id="save">Crear evento</button>
            <span class="hint" id="dirty" hidden>Cambios sin guardar</span>
          </div>
        </form>

        <section class="card" id="whitelist" hidden>
          <div class="card-head">
            <div><p class="eyebrow">Whitelist</p><h3 id="wl-count">0 jugadores con acceso</h3></div>
            <button class="btn sm" id="copy-names" type="button">Copiar nombres</button>
          </div>
          <div class="add">
            <textarea id="players-input" rows="2" placeholder="Nombres de Minecraft o UUIDs, separados por comas o saltos de línea"></textarea>
            <select id="players-rank" title="Rango que se les asigna al añadirlos"></select>
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
let openId = null; // null = nada, "new" = creando, "ranks" = rangos

const RANKS = ["invitado", "miembro", "staff", "developer", "owner"];
const RANK_NAMES = { invitado: "Invitado", miembro: "Miembro", staff: "Staff", developer: "Developer", owner: "Owner" };
const level = (r) => RANKS.indexOf(r || "invitado");
let members = [];
let assignable = [];
let me = { rank: "owner" };

function rankBadge(rank) {
  const s = document.createElement("span");
  s.className = "rank " + (rank || "invitado");
  s.textContent = RANK_NAMES[rank] || "Invitado";
  return s;
}

/** ¿Puedo cambiar el rango de esta cuenta? Desde el panel web (contraseña), a cualquiera. */
function canChange(p) {
  if (me.id === "web") return true;
  if (p.fixed || members.some((m) => m.fixed && m.uuid === p.uuid)) return false;
  return me.rank === "owner" || level(p.rank) < level(me.rank);
}

/** Selector de rango para una cuenta, o solo su insignia si no se puede cambiar. */
function rankControl(p) {
  if (!canChange(p)) return rankBadge(p.rank);
  const sel = document.createElement("select");
  sel.className = "rank-select";
  sel.title = "Cambiar rango";
  for (const r of RANKS.slice().reverse()) {
    if (!assignable.includes(r) && r !== (p.rank || "invitado")) continue;
    const o = document.createElement("option");
    o.value = r;
    o.textContent = RANK_NAMES[r];
    sel.appendChild(o);
  }
  sel.value = p.rank || "invitado";
  sel.addEventListener("change", async () => {
    sel.disabled = true;
    try {
      await setRank(p.uuid, p.name, sel.value);
      toast((p.name || "La cuenta") + " ahora es " + RANK_NAMES[sel.value], "ok");
    } catch (err) {
      toast(err.message, "err");
      sel.value = p.rank || "invitado";
    } finally {
      sel.disabled = false;
    }
  });
  return sel;
}

async function setRank(uuid, name, rank) {
  if (rank === "invitado") await api("DELETE", "/api/admin/members/" + uuid);
  else await api("PUT", "/api/admin/members/" + uuid, { name: name || null, rank });
  await refresh();
}

async function loadMembers() {
  const r = await api("GET", "/api/admin/members");
  members = r.members;
  assignable = r.assignable;
  me = r.me;
  fillRankSelect($("players-rank"), true);
  fillRankSelect($("members-rank"), false);
}

function fillRankSelect(sel, keepOption) {
  const old = sel.value;
  sel.replaceChildren();
  if (keepOption) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "Sin cambiar rango";
    sel.appendChild(o);
  }
  for (const r of RANKS.slice().reverse()) {
    if (!assignable.includes(r)) continue;
    const o = document.createElement("option");
    o.value = r;
    o.textContent = r === "invitado" && !keepOption ? "Invitado (quitar rango)" : RANK_NAMES[r];
    sel.appendChild(o);
  }
  sel.value = old && [...sel.options].some((o) => o.value === old) ? old : assignable.includes("miembro") ? "miembro" : "";
}

/** Vuelve a pedir eventos y rangos sin perder lo que está abierto. */
async function refresh() {
  events = (await api("GET", "/api/admin/events")).events;
  await loadMembers();
  renderList();
  if (openId === "ranks") renderMembers();
  else renderPlayers();
}

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
  if (res.status === 401 && path !== "/api/admin/web-login") { logout(false); throw new Error(data.error || "La sesión ha caducado; vuelve a entrar."); }
  if (!res.ok) throw new Error(data.error || "Error " + res.status);
  return data;
}

function showLogin() { $("login").hidden = false; $("app").hidden = true; $("password").focus(); }
/** Borra la sesión del navegador; con remote = true también la invalida en el servidor. */
function logout(remote) {
  const old = token;
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  if (remote && old) {
    fetch("/api/admin/logout", { method: "POST", headers: { authorization: "Bearer " + old }, keepalive: true }).catch(() => {});
  }
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
$("logout").addEventListener("click", () => logout(true));
$("logout-all").addEventListener("click", async () => {
  if (!confirm("¿Cerrar el panel en todos los navegadores? Tendrás que volver a entrar con la contraseña.")) return;
  try {
    await api("POST", "/api/admin/logout-all");
    logout(false);
    toast("Se cerraron todas las sesiones del panel", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
});

async function start() {
  try {
    events = (await api("GET", "/api/admin/events")).events;
    await loadMembers();
  } catch (err) {
    if (token) toast(err.message, "err");
    return;
  }
  $("login").hidden = true;
  $("app").hidden = false;
  renderList();
  if (openId && openId !== "new" && openId !== "ranks" && !current()) openId = null;
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
  const fabric = form.loader.value === "fabric";
  form.querySelector(".fabric-only").hidden = !fabric;
  $("mods-vanilla").hidden = fabric || mods.length === 0;
  $("update-mods").hidden = !mods.some((m) => m.project_id && m.mc && m.mc !== form.minecraft_version.value.trim());
}
form.loader.addEventListener("change", () => { updateVisibility(); fillFabric(); markDirty(); });
form.addEventListener("input", (e) => { if (e.target.id !== "mod-search") markDirty(); });
function markDirty() { $("dirty").hidden = false; }

// Versión de Fabric Loader automática: la última estable para esa versión de
// Minecraft. Solo pisa el campo si está vacío o lo rellenó esto mismo.
let fabricAuto = false;
let fabricTimer = null;
let fabricSeq = 0;
form.loader_version.addEventListener("input", () => { fabricAuto = false; });
form.minecraft_version.addEventListener("input", () => {
  clearTimeout(fabricTimer);
  fabricTimer = setTimeout(fillFabric, 500);
  updateVisibility();
});
async function fillFabric() {
  if (form.loader.value !== "fabric") return;
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
  $("open-ranks").classList.toggle("current", openId === "ranks");
  $("ranks").hidden = openId !== "ranks";
  if (openId === "ranks") {
    $("empty").hidden = true;
    $("editor").hidden = true;
    renderMembers();
    return;
  }
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
  form.minecraft_version.value = ev ? ev.minecraft_version : "1.21.1";
  form.loader.value = ev ? ev.loader : "vanilla";
  form.loader_version.value = ev ? ev.loader_version || "" : "";
  form.memory_max.value = ev && ev.memory ? ev.memory.max_mb : ev ? "" : "4096";
  form.image_url.value = ev ? ev.image_url || "" : "";
  showImage();
  form.active.checked = ev ? ev.active : true;
  mods = [];
  pack = null;
  $("mod-search").value = "";
  $("mod-results").replaceChildren();
  updateVisibility();
  renderMods();
  if (ev && ev.pack_code) loadPack(ev);
  fabricAuto = false;
  $("fabric-hint").textContent = "";
  fillFabric();
  $("dirty").hidden = true;
  $("whitelist").hidden = !ev;
  $("filter").value = "";
  renderPlayers();
}

function eventInput() {
  const t = (v) => v.trim() || null;
  const max = Number(form.memory_max.value);
  const loader = form.loader.value;
  return {
    name: form.name.value.trim(),
    description: t(form.description.value),
    server_address: t(form.server_address.value),
    image_url: t(form.image_url.value),
    pack_code: null,
    minecraft_version: t(form.minecraft_version.value),
    loader,
    loader_version: loader === "vanilla" ? null : t(form.loader_version.value),
    memory: max > 0 ? { min_mb: Math.min(2048, max), max_mb: max } : null,
    active: form.active.checked,
  };
}

// ───── Mods (se guardan como un pack del servidor) ─────
let mods = [];     // lo que se está editando
let pack = null;   // manifiesto del pack guardado (si lo hay)
let modsDirty = false;
let packLoading = false;

async function loadPack(ev) {
  packLoading = true;
  $("mods-count").textContent = "Cargando mods…";
  try {
    const p = await api("GET", "/api/admin/packs/" + ev.pack_code);
    if (current() !== ev) return;
    pack = p;
    mods = (p.mods || []).map((m) => ({ ...m }));
    modsDirty = false;
  } catch (err) {
    toast("No se pudieron cargar los mods: " + err.message, "err");
  } finally {
    packLoading = false;
    renderMods();
    updateVisibility();
  }
}

const mb = (n) => (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + " MB";

function renderMods() {
  const list = $("mod-list");
  list.replaceChildren();
  if (!packLoading) $("mods-count").textContent = mods.length ? mods.length + (mods.length === 1 ? " mod" : " mods") : "Sin mods";
  for (const m of mods) {
    const li = document.createElement("li");
    const ic = document.createElement(m.icon_url ? "img" : "div");
    ic.className = "ic";
    if (m.icon_url) { ic.src = m.icon_url; ic.alt = ""; }
    const main = document.createElement("div");
    main.className = "m-main";
    const t = document.createElement("strong"); t.textContent = m.title || m.file_name;
    const f = document.createElement("span"); f.className = "mono"; f.textContent = m.file_name + (m.size ? " · " + mb(m.size) : "");
    main.append(t, f);
    const src = document.createElement("span");
    src.className = "src" + (m.dependency ? " dep" : "");
    src.textContent = m.dependency ? "dependencia" : m.project_id ? "Modrinth" : "subido";
    const x = document.createElement("button");
    x.type = "button"; x.className = "x"; x.title = "Quitar"; x.textContent = "✕";
    x.addEventListener("click", () => { mods = mods.filter((y) => y !== m); changedMods(); });
    li.append(ic, main, src, x);
    list.appendChild(li);
  }
  renderResults();
}

function changedMods() { modsDirty = true; markDirty(); renderMods(); updateVisibility(); }

const MR = "https://api.modrinth.com/v2";
async function mr(path) {
  const res = await fetch(MR + path);
  if (!res.ok) throw new Error("Modrinth respondió " + res.status);
  return res.json();
}
const q = (v) => encodeURIComponent(JSON.stringify(v));

/** La mejor versión de un proyecto para la versión de Minecraft actual (release si hay). */
async function bestVersion(projectId, mc) {
  const list = await mr("/project/" + projectId + "/version?loaders=" + q(["fabric"]) + "&game_versions=" + q([mc]));
  return list.find((v) => v.version_type === "release") || list[0] || null;
}

function entryFrom(project, version, mc, dependency) {
  const file = version.files.find((f) => f.primary) || version.files[0];
  return {
    file_name: file.filename,
    url: file.url,
    sha1: file.hashes.sha1,
    size: file.size,
    title: project.title,
    project_id: project.id,
    icon_url: project.icon_url || null,
    mc,
    ...(dependency ? { dependency: true } : {}),
  };
}

/** Añade un proyecto y sus dependencias obligatorias. Devuelve los títulos añadidos. */
async function addProject(projectId, mc, dependency, seen = new Set()) {
  if (seen.has(projectId) || mods.some((m) => m.project_id === projectId)) return [];
  seen.add(projectId);
  const [project, version] = await Promise.all([mr("/project/" + projectId), bestVersion(projectId, mc)]);
  if (!version) throw new Error(project.title + " no tiene versión para Fabric " + mc);
  const entry = entryFrom(project, version, mc, dependency);
  if (mods.some((m) => m.file_name === entry.file_name)) return [];
  mods.push(entry);
  const added = [project.title];
  for (const d of version.dependencies || []) {
    if (d.dependency_type !== "required" || !d.project_id) continue;
    try { added.push(...(await addProject(d.project_id, mc, true, seen))); }
    catch (err) { toast("Dependencia: " + err.message, "err"); }
  }
  return added;
}

let results = [];
let searchTimer = null;
let searchSeq = 0;
$("mod-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 350);
});
$("mod-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); search(); } });

async function search() {
  const text = $("mod-search").value.trim();
  const mc = form.minecraft_version.value.trim();
  const seq = ++searchSeq;
  if (!text) { results = []; renderResults(); return; }
  try {
    const facets = [["project_type:mod"], ["categories:fabric"], ["versions:" + mc]];
    const data = await mr("/search?limit=10&query=" + encodeURIComponent(text) + "&facets=" + q(facets));
    if (seq !== searchSeq) return;
    results = data.hits;
    renderResults();
  } catch (err) {
    if (seq === searchSeq) toast(err.message, "err");
  }
}

function renderResults() {
  const box = $("mod-results");
  box.replaceChildren();
  if (!$("mod-search").value.trim()) return;
  if (results.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "Nada para Fabric " + form.minecraft_version.value.trim() + ".";
    box.appendChild(li);
    return;
  }
  for (const h of results) {
    const li = document.createElement("li");
    const ic = document.createElement(h.icon_url ? "img" : "div");
    ic.className = "ic";
    if (h.icon_url) { ic.src = h.icon_url; ic.alt = ""; }
    const main = document.createElement("div");
    main.className = "m-main";
    const t = document.createElement("strong"); t.textContent = h.title;
    const d = document.createElement("span"); d.textContent = h.description;
    main.append(t, d);
    const has = mods.some((m) => m.project_id === h.project_id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn sm" + (has ? "" : " primary");
    b.textContent = has ? "Añadido" : "+ Añadir";
    b.disabled = has;
    b.addEventListener("click", async () => {
      if (form.loader.value !== "fabric") { toast("Los mods necesitan Fabric: cambia el loader arriba.", "err"); return; }
      b.disabled = true;
      b.textContent = "Añadiendo…";
      try {
        const added = await addProject(h.project_id, form.minecraft_version.value.trim(), false);
        if (added.length > 1) toast("Añadido " + added[0] + " con: " + added.slice(1).join(", "), "ok");
      } catch (err) {
        toast(err.message, "err");
      }
      changedMods();
    });
    li.append(ic, main, b);
    box.appendChild(li);
  }
}

$("update-mods").addEventListener("click", async () => {
  const mc = form.minecraft_version.value.trim();
  const btn = $("update-mods");
  btn.disabled = true;
  btn.textContent = "Actualizando…";
  const missing = [];
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (!m.project_id || m.mc === mc) continue;
    try {
      const v = await bestVersion(m.project_id, mc);
      if (!v) { missing.push(m.title); continue; }
      mods[i] = entryFrom({ id: m.project_id, title: m.title, icon_url: m.icon_url }, v, mc, m.dependency);
    } catch { missing.push(m.title); }
  }
  btn.disabled = false;
  btn.textContent = "Actualizar a esta versión";
  changedMods();
  if (missing.length) toast("Sin versión para " + mc + ": " + missing.join(", ") + ". Quítalos o vuelve a la versión anterior.", "err");
  else toast("Mods actualizados a " + mc, "ok");
});

/** Hasta aquí se sube siempre de una vez; lo que pase, el servidor dice si de una vez o por partes. */
const SINGLE_UPLOAD_MAX = 20 * 1048576;

async function putFile(path, body) {
  let last;
  for (let tries = 0; tries < 3; tries++) {
    const res = await fetch(path, { method: "PUT", headers: { authorization: "Bearer " + token }, body });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    last = new Error(data.error || "Error " + res.status);
    if (res.status < 500 && res.status !== 429) break;
  }
  throw last;
}

/** Sube un .jar (de una vez o por partes) y devuelve su SHA-1. */
async function uploadJar(file, btn) {
  const label = "Subiendo " + file.name + "…";
  btn.textContent = label;
  const buf = await file.arrayBuffer();
  const sha1 = [...new Uint8Array(await crypto.subtle.digest("SHA-1", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (file.size <= SINGLE_UPLOAD_MAX) {
    await putFile("/api/files/" + sha1, buf);
    return sha1;
  }
  const base = "/api/files/" + sha1 + "/multipart";
  const up = await api("POST", base, { size: file.size });
  if (up.existed) return sha1;
  if (up.single) {
    await putFile("/api/files/" + sha1, buf);
    return sha1;
  }
  try {
    const parts = [];
    for (let n = 1; n <= up.parts; n++) {
      btn.textContent = label + " " + Math.floor(((n - 1) / up.parts) * 100) + " %";
      const part = await putFile(base + "/" + n, buf.slice((n - 1) * up.part_size, n * up.part_size));
      parts.push({ part_number: n, etag: part.etag });
    }
    btn.textContent = label + " 100 %";
    await api("POST", base + "/complete", { parts });
  } catch (err) {
    api("DELETE", base).catch(() => {});
    throw err;
  }
  return sha1;
}

// ── Imagen de fondo: se sube como cualquier archivo y el evento apunta a /files/<sha1>.
// El launcher la descarga si pesa hasta 15 MB y es PNG, JPG, WEBP o GIF.
const IMAGE_MAX = 15 * 1048576;

function isImage(b) {
  const starts = (sig) => sig.every((v, i) => b[i] === v);
  return (
    starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    starts([0xff, 0xd8, 0xff]) ||
    starts([0x47, 0x49, 0x46, 0x38]) ||
    (starts([0x52, 0x49, 0x46, 0x46]) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
  );
}

function showImage() {
  const url = form.image_url.value.trim();
  const img = $("image-preview");
  $("image-clear").hidden = !url;
  if (!/^https:\\/\\/|^\\/files\\//.test(url) && !url.startsWith(location.origin + "/files/")) {
    img.hidden = true;
    img.removeAttribute("src");
    return;
  }
  img.hidden = false;
  if (img.getAttribute("src") !== url) img.src = url;
}

$("image-preview").addEventListener("error", () => { $("image-preview").hidden = true; });
form.image_url.addEventListener("input", showImage);
$("image-clear").addEventListener("click", () => { form.image_url.value = ""; showImage(); markDirty(); });
$("image-upload-btn").addEventListener("click", () => $("image-input").click());
$("image-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const btn = $("image-upload-btn");
  btn.disabled = true;
  btn.textContent = "Subiendo…";
  try {
    if (file.size > IMAGE_MAX) throw new Error("pesa más de 15 MB y el launcher no la descargaría");
    const buf = await file.arrayBuffer();
    if (!isImage(new Uint8Array(buf.slice(0, 12)))) throw new Error("tiene que ser PNG, JPG, WEBP o GIF");
    const sha1 = [...new Uint8Array(await crypto.subtle.digest("SHA-1", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await putFile("/api/files/" + sha1, buf);
    form.image_url.value = location.origin + "/files/" + sha1;
    showImage();
    markDirty();
    toast("Foto subida. Guarda el evento para usarla.", "ok");
  } catch (err) {
    toast(file.name + ": " + err.message, "err");
  }
  btn.disabled = false;
  btn.textContent = "Subir foto";
});

$("upload-btn").addEventListener("click", () => $("upload-input").click());
$("upload-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  const btn = $("upload-btn");
  btn.disabled = true;
  for (const file of files) {
    try {
      if (!file.name.toLowerCase().endsWith(".jar")) throw new Error("solo archivos .jar");
      const sha1 = await uploadJar(file, btn);
      const name = file.name.replace(/[\\\\/]/g, "_");
      mods = mods.filter((m) => m.file_name !== name);
      mods.push({ file_name: name, url: location.origin + "/files/" + sha1, sha1, size: file.size, title: name.replace(/\\.jar$/i, "") });
      changedMods();
    } catch (err) {
      toast(file.name + ": " + err.message, "err");
    }
  }
  btn.disabled = false;
  btn.textContent = "Subir .jar";
});

/** Crea el pack si hace falta y devuelve el código que debe usar el evento (o null). */
async function packCodeFor(ev, input) {
  const old = ev ? ev.pack_code || null : null;
  const extra = pack && ((pack.resourcepacks || []).length || (pack.shaderpacks || []).length || (pack.config_files || []).length);
  if (mods.length === 0 && !extra) return null;
  if (input.loader !== "fabric" && mods.length) throw new Error("Los mods necesitan Fabric: cambia el loader.");
  const same =
    old && pack && !modsDirty &&
    pack.minecraft_version === input.minecraft_version &&
    pack.loader === input.loader &&
    (pack.loader_version || null) === input.loader_version;
  if (same) return old;
  const created = await api("POST", "/api/packs", {
    code: "",
    name: input.name,
    minecraft_version: input.minecraft_version,
    loader: input.loader,
    loader_version: input.loader_version,
    java: pack ? pack.java || null : null,
    memory: input.memory,
    mods,
    resourcepacks: pack ? pack.resourcepacks || [] : [],
    shaderpacks: pack ? pack.shaderpacks || [] : [],
    config_files: pack ? pack.config_files || [] : [],
  });
  return created.code;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  $("save").disabled = true;
  try {
    const ev = current();
    if (packLoading) throw new Error("Espera a que carguen los mods");
    const input = eventInput();
    const oldCode = ev ? ev.pack_code || null : null;
    input.pack_code = await packCodeFor(ev, input);
    const saved = ev
      ? await api("PUT", "/api/admin/events/" + ev.id, input)
      : await api("POST", "/api/admin/events", input);
    // El pack anterior ya no lo usa nadie: se borra (si falla no pasa nada).
    if (oldCode && oldCode !== saved.pack_code) api("DELETE", "/api/packs/" + oldCode).catch(() => {});
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
    x.disabled = me.id !== "web" && me.rank !== "owner" && level(p.rank) >= level(me.rank);
    x.addEventListener("click", async () => {
      try {
        ev.players = (await api("DELETE", "/api/admin/events/" + ev.id + "/players/" + p.uuid)).players;
        renderPlayers();
        renderList();
      } catch (err) { toast(err.message, "err"); }
    });
    li.append(n, rankControl(p), u, x);
    list.appendChild(li);
  }
}

function renderMembers() {
  const list = $("members");
  list.replaceChildren();
  const shown = members.filter((m) => m.fixed || m.rank !== "invitado");
  if (shown.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "Nadie tiene rango todavía. Todos son Invitado.";
    list.appendChild(li);
  }
  for (const m of shown) {
    const li = document.createElement("li");
    const n = document.createElement("span"); n.className = "p-name"; n.textContent = m.name || "(sin nombre)";
    const u = document.createElement("span"); u.className = "p-uuid mono";
    u.textContent = m.fixed ? m.uuid + " · ADMIN_UUIDS" : m.uuid;
    li.append(n, rankControl(m), u);
    if (canChange(m)) {
      const x = document.createElement("button"); x.className = "x"; x.title = "Quitar rango (pasa a Invitado)"; x.textContent = "✕";
      x.addEventListener("click", async () => {
        try { await setRank(m.uuid, m.name, "invitado"); toast((m.name || "La cuenta") + " vuelve a ser Invitado", "ok"); }
        catch (err) { toast(err.message, "err"); }
      });
      li.appendChild(x);
    }
    list.appendChild(li);
  }
}

async function resolveAll(text) {
  const queries = text.split(/[\\s,;]+/).map((q) => q.trim()).filter(Boolean);
  const found = [];
  const failed = [];
  for (const q of queries) {
    try { found.push(await api("GET", "/api/admin/resolve?q=" + encodeURIComponent(q))); }
    catch (err) { failed.push({ q, msg: err.message }); }
  }
  return { queries, found, failed };
}

async function addMembers() {
  const rank = $("members-rank").value;
  const btn = $("add-members");
  btn.disabled = true;
  btn.textContent = "Buscando…";
  try {
    const { found, failed } = await resolveAll($("members-input").value);
    const errors = failed.map((f) => f.q + ": " + f.msg);
    let ok = 0;
    for (const p of found) {
      try {
        if (rank === "invitado") await api("DELETE", "/api/admin/members/" + p.uuid);
        else await api("PUT", "/api/admin/members/" + p.uuid, { name: p.name, rank });
        ok++;
      } catch (err) { errors.push(p.name + ": " + err.message); }
    }
    if (ok) toast(ok + " cuenta(s) ahora con rango " + RANK_NAMES[rank], "ok");
    if (errors.length) toast(errors.join("\\n"), "err");
    $("members-input").value = failed.map((f) => f.q).join("\\n");
    await refresh();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Dar rango";
  }
}
$("add-members").addEventListener("click", addMembers);
$("members-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addMembers(); }
});
$("open-ranks").addEventListener("click", () => { openId = "ranks"; renderList(); renderEditor(); });
$("filter").addEventListener("input", renderPlayers);

async function addPlayers() {
  const ev = current();
  if (!ev) return;
  if (!$("players-input").value.trim()) return;
  const rank = $("players-rank").value || null;
  const btn = $("add-players");
  btn.disabled = true;
  btn.textContent = "Buscando…";
  const { found, failed } = await resolveAll($("players-input").value);
  try {
    if (found.length) {
      const players = found.map((p) => (rank ? { ...p, rank } : p));
      ev.players = (await api("POST", "/api/admin/events/" + ev.id + "/players", { players })).players;
      toast(found.length + " jugador(es) añadidos a la whitelist" + (rank ? " como " + RANK_NAMES[rank] : ""), "ok");
      if (rank) await loadMembers();
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
