import { ADMIN_HTML, ADMIN_JS } from "./admin-page.js";

// Servidor de Obsidia Eventos (Cloudflare Worker + KV/R2).
//
// Es un cliente privado: solo entra quien está en la whitelist de algún
// evento. La whitelist vive AQUÍ, no en el launcher, así que modificar el
// launcher no sirve para colarse: sin estar en la lista, el servidor no
// entrega ni la dirección del servidor de Minecraft ni el pack.
//
// Sesión (cualquier cuenta de Minecraft real):
//   POST /api/challenge          -> { serverId, ticket }
//   POST /api/login              { uuid, ticket, publicKey, ... } -> { token, uuid }
//
// Jugadores (con sesión):
//   GET  /api/events             -> { uuid, admin, events } solo los eventos donde está en la whitelist
//
// Administración (según el rango; ver RANKS más abajo):
//   GET    /api/admin/events                      todos los eventos con su whitelist        (Staff+)
//   POST   /api/admin/events                      crear evento                               (Developer+)
//   PUT    /api/admin/events/<EVT-XXXXXX>         editar evento                              (Developer+)
//   DELETE /api/admin/events/<EVT-XXXXXX>         borrar evento                              (Developer+)
//   POST   /api/admin/events/<id>/players         { players: [{ uuid, name, rank? }] }       (Staff+)
//   DELETE /api/admin/events/<id>/players/<uuid>  quitar de la whitelist                     (Staff+)
//   GET    /api/admin/members                     rangos de todo el mundo                    (Staff+)
//   PUT    /api/admin/members/<uuid>              { name, rank } dar un rango                (Staff+)
//   DELETE /api/admin/members/<uuid>              quitar el rango (vuelve a Invitado)        (Staff+)
//   PUT    /api/files/<sha1>, POST /api/packs     subir el pack del evento                   (Developer+)
//   DELETE /api/packs/<code>                                                                  (Developer+)
//
// Panel web (contraseña ADMIN_PASSWORD):
//   GET  /admin                                  la página del panel
//   POST /api/admin/web-login    { password }    -> { token } sesión web de admin (12 h)
//                                                 5 fallos en 15 min bloquean la IP 15 min
//   POST /api/admin/logout                       cierra la sesión web actual en el servidor
//   POST /api/admin/logout-all                   cierra todas las sesiones web (admin)
//   GET  /api/admin/resolve?q=<nombre|uuid>      -> { uuid, name } (admin)
//   GET  /api/admin/packs/<OBS-XXXXXX>           el manifiesto de un pack (admin)
//
// Servidor de Minecraft (clave SERVER_KEY):
//   GET  /api/server/<EVT-XXXXXX>/whitelist.json  la whitelist en el formato de Minecraft
//
// Archivos: GET /files/<sha1> (la ruta es el propio hash, imposible de adivinar).
//
// Inicio de sesión: con el certificado de jugador de Mojang (el par de claves
// que Minecraft usa para firmar el chat). Mojang firma la clave pública de cada
// cuenta; el launcher firma nuestro desafío con la clave privada. Aquí se
// comprueban las dos firmas sin llamar a Mojang (Mojang bloquea las peticiones
// que salen de Cloudflare). El token de Minecraft nunca llega a este servidor.

const MODRINTH_CDN = "cdn.modrinth.com";
// Claves con las que Mojang firma los certificados de jugador
// (`playerCertificateKeys` de https://api.minecraftservices.com/publickeys).
// Si Mojang las cambia, se pueden sobrescribir con la variable MOJANG_PLAYER_KEYS
// (claves base64 separadas por comas) sin tocar el código.
const MOJANG_PLAYER_KEYS = [
  "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAylB4B6m5lz7jwrcFz6Fd/fnfUhcvlxsTSn5kIK/2aGG1C3kMy4VjhwlxF6BFUSnfxhNswPjh3ZitkBxEAFY25uzkJFRwHwVA9mdwjashXILtR6OqdLXXFVyUPIURLOSWqGNBtb08EN5fMnG8iFLgEJIBMxs9BvF3s3/FhuHyPKiVTZmXY0WY4ZyYqvoKR+XjaTRPPvBsDa4WI2u1zxXMeHlodT3lnCzVvyOYBLXL6CJgByuOxccJ8hnXfF9yY4F0aeL080Jz/3+EBNG8RO4ByhtBf4Ny8NQ6stWsjfeUIvH7bU/4zCYcYOq4WrInXHqS8qruDmIl7P5XXGcabuzQstPf/h2CRAUpP/PlHXcMlvewjmGU6MfDK+lifScNYwjPxRo4nKTGFZf/0aqHCh/EAsQyLKrOIYRE0lDG3bzBh8ogIMLAugsAfBb6M3mqCqKaTMAf/VAjh5FFJnjS+7bE+bZEV0qwax1CEoPPJL1fIQjOS8zj086gjpGRCtSy9+bTPTfTR/SJ+VUB5G2IeCItkNHpJX2ygojFZ9n5Fnj7R9ZnOM+L8nyIjPu3aePvtcrXlyLhH/hvOfIOjPxOlqW+O5QwSFP4OEcyLAUgDdUgyW36Z5mB285uKW/ighzZsOTevVUG2QwDItObIV6i8RCxFbN2oDHyPaO5j1tTaBNyVt8CAwEAAQ==",
  "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAt4t9NPuu7cktclnaH7eZj0omkLcJHeLz5MKsyJEntHZ0INtuBjSSul3Pp3pBeJN8k3ADdcdBLUN90bcAi7WsQqTx3Ft363q3W7TbM8j2iTEdp/0uVspoRt/DP1tkaWFs/w2WwUv9jbVoBUzfUc4pSTIxRwdjmqjZQfvjwKNDbOx3IhP2H0WXodbISejPi1wBZqNW4m1rnZAXp/EpUguxA8mobCa4vUCBkyFDyXdl69/wUSJHyCPmgcMJ364OlAhIqtwVPShBZObvrK/f0BYk6ShJD3N7TFDatSYsIIdcTKRknaIm91s+EsMrdB9U4Yw+ZJ/pyCB4S3vk8zfDCnb0DWIxYH3/EMzaxl77djmTmMzi/JDITup5z3jfWtRZmrAhU2/+W5IO5hEpo3/bCS9PXIY5xb41Lmp2ZO8dXKtyD66Chchy0W129n8vPl2GIruOdrxsjZAHnneyAb9jm0uaGaphwnEnuecX/qgHY6ZMtayvLLsPst8PO6R1vufMy8WqjK+j7LnC1krL7CPDg0NEhyQTmw5l+NCNjSlvB1juM9V4PARg0bYCOkGXm7ydRCjSSH8CJXZpwnd5cBB5WKAX3KPzutRgMi/LFwNSMZzFuUyXaYOZPpD259yqph1LmGqegEdDriACVU+dVEONFMm8eIuBofe7ljmsAFKW9BINwK0CAwEAAQ==",
];
const LOGIN_PREFIX = "obsidia-share-login\n";
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_RE = /^OBS-[A-Z0-9]{6}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const UUID_RE = /^[0-9a-f]{32}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MANIFEST_FILES = 512;
const CHALLENGE_TTL_S = 120;
const TOKEN_TTL_S = 60 * 60;
const FILE_LISTS = ["mods", "resourcepacks", "shaderpacks", "config_files"];
const EVENTS_KEY = "events/index.json";
const EVENT_ID_RE = /^EVT-[A-Z0-9]{6}$/;
const MAX_EVENTS = 100;
const MAX_PLAYERS_PER_EVENT = 2000;
const MC_NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const MC_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LOADER_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
// host o host:puerto (sin esquema).
const SERVER_ADDRESS_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?$/;

// Rangos globales (uno por persona para todos los eventos), de menor a mayor.
//   owner      todo, incluido dar cualquier rango
//   developer  crear/editar eventos y packs, whitelist, dar rangos hasta staff
//   staff      whitelist, dar miembro/invitado; entra a todos los eventos
//   miembro    jugar (si está en la whitelist del evento)
//   invitado   jugar (si está en la whitelist del evento); el rango por defecto
// Las cuentas de ADMIN_UUIDS y el panel web (contraseña) son owner fijos.
const RANKS = ["invitado", "miembro", "staff", "developer", "owner"];
const RANK_NAMES = { invitado: "Invitado", miembro: "Miembro", staff: "Staff", developer: "Developer", owner: "Owner" };
const MEMBERS_KEY = "members/index.json";
const MAX_MEMBERS = 5000;

const WEB_TOKEN_TTL_S = 12 * 60 * 60;
const WEB_ADMIN = "web";
const WEB_SESSIONS_KEY = "web/sessions.json";
// Fuerza bruta: 5 contraseñas mal en 15 minutos bloquean esa IP 15 minutos.
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_S = 15 * 60;
const LOGIN_LOCK_S = 15 * 60;
// Tamaño máximo del cuerpo en las rutas de login (públicas).
const MAX_WEB_LOGIN_BODY = 4 * 1024;
const MAX_LOGIN_BODY = 16 * 1024;

const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      // R2 si está configurado (pide tarjeta, aunque sea gratis); si no, Workers KV.
      if (!env.BUCKET && env.FILES) env = { ...env, BUCKET: kvBucket(env.FILES), USING_KV: true };
      if (!env.BUCKET) throw new HttpError(500, "falta configurar el almacenamiento (FILES o BUCKET en wrangler.toml)");
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.headers);
      console.error(e);
      return json({ error: "error interno del servidor" }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

/** Lee un JSON pequeño sin aceptar cuerpos enormes (para las rutas públicas). */
async function readSmallJson(request, max) {
  if (Number(request.headers.get("content-length")) > max) throw new HttpError(413, "petición demasiado grande");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "petición demasiado grande");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Workers KV: un valor no puede pasar de 25 MiB. */
const KV_MAX_VALUE = 25 * 1024 * 1024;

/**
 * Adapta Workers KV a la parte de la API de R2 que usa este archivo
 * (`get`, `head`, `put`, `delete`). KV no tiene `head`, así que lee el valor.
 */
function kvBucket(kv) {
  const wrap = (value, metadata) =>
    value === null
      ? null
      : {
          size: metadata?.size ?? value.byteLength,
          customMetadata: metadata?.custom ?? {},
          body: value,
          json: async () => JSON.parse(new TextDecoder().decode(value)),
        };
  const get = async (key) => {
    const { value, metadata } = await kv.getWithMetadata(key, "arrayBuffer");
    return wrap(value, metadata);
  };
  return {
    get,
    head: get,
    async put(key, value, opts = {}) {
      const bytes = typeof value === "string" ? enc.encode(value) : new Uint8Array(value);
      await kv.put(key, bytes, {
        metadata: { size: bytes.byteLength, custom: opts.customMetadata ?? {} },
        // KV borra solo las claves temporales (mínimo 60 s). R2 lo ignora.
        ...(opts.expirationTtl ? { expirationTtl: Math.max(60, Math.ceil(opts.expirationTtl)) } : {}),
      });
    },
    async delete(key) {
      await kv.delete(key);
    },
  };
}

function limits(env) {
  const mb = (v, d) => (Number(v) > 0 ? Number(v) : d) * 1024 * 1024;
  const maxFile = mb(env.MAX_FILE_MB, env.USING_KV ? 25 : 50);
  return {
    maxFile: env.USING_KV ? Math.min(maxFile, KV_MAX_VALUE) : maxFile,
    dailyUpload: mb(env.DAILY_UPLOAD_MB, 1024),
    dailyPacks: Number(env.DAILY_PACKS) > 0 ? Number(env.DAILY_PACKS) : 30,
  };
}

async function route(request, env) {
  if (!env.SECRET || env.SECRET.length < 32) {
    throw new HttpError(500, "falta configurar SECRET (wrangler secret put SECRET)");
  }
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/" && method === "GET") {
    return json({ service: "obsidia-eventos", version: 1 });
  }

  if ((path === "/admin" || path === "/admin/") && method === "GET") return page(ADMIN_HTML, "text/html");
  if (path === "/admin/app.js" && method === "GET") return page(ADMIN_JS, "text/javascript");
  if (path === "/api/admin/web-login" && method === "POST") return webLogin(request, env);
  if (path === "/api/admin/logout" && method === "POST") return webLogout(request, env);
  if (path === "/api/admin/logout-all" && method === "POST") return webLogoutAll(request, env);
  if (path === "/api/admin/resolve" && method === "GET") return adminResolve(request, env, url);

  let m = path.match(/^\/files\/([0-9a-f]{40})$/);
  if (m && (method === "GET" || method === "HEAD")) {
    const key = `files/${m[1]}`;
    const obj = method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : obj.body, {
      headers: {
        "content-type": "application/octet-stream",
        "x-content-type-options": "nosniff",
        "content-length": String(obj.size),
        // El contenido de una ruta es su propio hash: nunca cambia.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  }

  if (path === "/api/challenge" && method === "POST") return challenge(env);
  if (path === "/api/login" && method === "POST") return login(request, env);

  if (path === "/api/events" && method === "GET") return listMyEvents(request, env);

  m = path.match(/^\/api\/server\/(EVT-[A-Z0-9]{6})\/whitelist\.json$/);
  if (m && method === "GET") return serverWhitelist(request, env, url, m[1]);

  m = path.match(/^\/api\/files\/([0-9a-f]{40})$/);
  if (m && method === "PUT") return uploadFile(request, env, m[1]);

  if (path === "/api/packs" && method === "POST") return createPack(request, env, url.origin);

  m = path.match(/^\/api\/packs\/(OBS-[A-Z0-9]{6})$/);
  if (m && method === "DELETE") return deletePack(request, env, m[1]);
  m = path.match(/^\/api\/admin\/packs\/(OBS-[A-Z0-9]{6})$/);
  if (m && method === "GET") return adminGetPack(request, env, m[1]);

  if (path === "/api/admin/events" && method === "GET") return adminListEvents(request, env);
  if (path === "/api/admin/events" && method === "POST") return adminSaveEvent(request, env, null);
  m = path.match(/^\/api\/admin\/events\/(EVT-[A-Z0-9]{6})$/);
  if (m && method === "PUT") return adminSaveEvent(request, env, m[1]);
  if (m && method === "DELETE") return adminDeleteEvent(request, env, m[1]);
  m = path.match(/^\/api\/admin\/events\/(EVT-[A-Z0-9]{6})\/players$/);
  if (m && method === "POST") return adminAddPlayers(request, env, m[1]);
  m = path.match(/^\/api\/admin\/events\/(EVT-[A-Z0-9]{6})\/players\/([0-9a-fA-F-]{32,36})$/);
  if (m && method === "DELETE") return adminRemovePlayer(request, env, m[1], m[2]);

  if (path === "/api/admin/members" && method === "GET") return adminListMembers(request, env);
  m = path.match(/^\/api\/admin\/members\/([0-9a-fA-F-]{32,36})$/);
  if (m && method === "PUT") return adminSetMember(request, env, m[1]);
  if (m && method === "DELETE") return adminRemoveMember(request, env, m[1]);

  return json({ error: "ruta no encontrada" }, 404);
}

// ───────────────────────────── Firma (HMAC) ─────────────────────────────

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(env, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Firma `parts` (sin puntos) con caducidad. Devuelve `parts...exp.firma`. */
async function sign(env, kind, parts, ttl) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const body = [kind, ...parts, exp].join(".");
  return `${[...parts, exp].join(".")}.${await hmac(env, body)}`;
}

/** Comprueba firma y caducidad; devuelve las partes firmadas o lanza 401. */
async function verify(env, kind, value, nParts) {
  const pieces = String(value ?? "").split(".");
  if (pieces.length !== nParts + 2) throw new HttpError(401, "sesión no válida");
  const sig = pieces.pop();
  const exp = Number(pieces[nParts]);
  const expected = await hmac(env, [kind, ...pieces].join("."));
  if (!safeEqual(sig, expected)) throw new HttpError(401, "sesión no válida");
  if (!(exp > Date.now() / 1000)) throw new HttpError(401, "la sesión ha caducado; vuelve a intentarlo");
  return pieces.slice(0, nParts);
}

// ───────────────────────────── Sesión ─────────────────────────────

async function challenge(env) {
  const serverId = hex(crypto.getRandomValues(new Uint8Array(16)));
  return json({ serverId, ticket: await sign(env, "challenge", [serverId], CHALLENGE_TTL_S) });
}

const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const pemToDer = (pem) => b64decode(String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));

/** Milisegundos de un instante ISO de Mojang (trae nanosegundos; Java los trunca a ms). */
function isoMillis(iso) {
  const m = String(iso).match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/);
  if (!m) return NaN;
  return Date.parse(`${m[1]}Z`) + Number((m[2] ?? "0").padEnd(3, "0").slice(0, 3));
}

async function rsaVerify(spki, hash, signature, data) {
  try {
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  } catch {
    return false;
  }
}

/** ¿Mojang firmó esta clave pública para este UUID y esta caducidad? (publicKeySignatureV2) */
async function mojangSignedKey(env, uuid, expiresAtMs, spki, signature) {
  const payload = new Uint8Array(24 + spki.length);
  for (let i = 0; i < 16; i++) payload[i] = parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  new DataView(payload.buffer).setBigInt64(16, BigInt(expiresAtMs));
  payload.set(spki, 24);
  const keys = env.MOJANG_PLAYER_KEYS ? String(env.MOJANG_PLAYER_KEYS).split(",") : MOJANG_PLAYER_KEYS;
  for (const k of keys) {
    if (await rsaVerify(b64decode(k.trim()), "SHA-1", signature, payload)) return true;
  }
  return false;
}

async function login(request, env) {
  const body = await readSmallJson(request, MAX_LOGIN_BODY);
  const uuid = String(body?.uuid ?? "").replace(/-/g, "").toLowerCase();
  if (!UUID_RE.test(uuid)) throw new HttpError(400, "UUID no válido");
  const ticket = body?.ticket;
  await verify(env, "challenge", ticket, 1);

  const expiresAt = isoMillis(body?.expiresAt);
  if (!(expiresAt > Date.now())) throw new HttpError(401, "el certificado de tu cuenta ha caducado; vuelve a iniciar sesión");
  let spki, mojangSig, playerSig;
  try {
    spki = pemToDer(body.publicKey);
    mojangSig = b64decode(body.publicKeySignatureV2);
    playerSig = b64decode(body.signature);
  } catch {
    throw new HttpError(400, "certificado ilegible");
  }
  if (!(await mojangSignedKey(env, uuid, expiresAt, spki, mojangSig))) {
    throw new HttpError(401, "Mojang no ha firmado el certificado de esta cuenta");
  }
  if (!(await rsaVerify(spki, "SHA-256", playerSig, enc.encode(LOGIN_PREFIX + ticket)))) {
    throw new HttpError(401, "la firma de la cuenta no es válida");
  }
  const token = await sign(env, "token", [uuid], TOKEN_TTL_S);
  return json({ token, uuid });
}

async function requireUser(request, env) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "falta iniciar sesión");
  const [uuid] = await verify(env, "token", auth.slice(7), 1);
  return uuid;
}

// ───────────────────────────── Cuotas ─────────────────────────────

async function readQuota(env, uuid) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota/${uuid}/${day}`;
  const obj = await env.BUCKET.get(key);
  const data = obj ? await obj.json() : { bytes: 0, packs: 0 };
  return { key, data };
}

const writeQuota = (env, q) => env.BUCKET.put(q.key, JSON.stringify(q.data));

// ───────────────────────────── Archivos ─────────────────────────────

async function uploadFile(request, env, sha1) {
  const uuid = await requireAdmin(request, env);
  const lim = limits(env);
  const declared = Number(request.headers.get("content-length"));
  if (!(declared > 0)) throw new HttpError(411, "falta el tamaño del archivo");
  if (declared > lim.maxFile) throw new HttpError(413, "el archivo supera el tamaño máximo permitido");

  const key = `files/${sha1}`;
  if (await env.BUCKET.head(key)) return json({ url: `/files/${sha1}`, existed: true });

  const quota = await readQuota(env, uuid);
  if (quota.data.bytes + declared > lim.dailyUpload) {
    throw new HttpError(429, "has alcanzado el límite de subida de hoy");
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== declared || bytes.byteLength > lim.maxFile) {
    throw new HttpError(400, "el tamaño recibido no coincide");
  }
  const got = hex(await crypto.subtle.digest("SHA-1", bytes));
  if (got !== sha1) throw new HttpError(400, "el SHA-1 del archivo no coincide");

  await env.BUCKET.put(key, bytes, { customMetadata: { uploader: uuid } });
  quota.data.bytes += bytes.byteLength;
  await writeQuota(env, quota);
  return json({ url: `/files/${sha1}`, existed: false }, 201);
}

// ───────────────────────────── Packs ─────────────────────────────

function validFileName(name, list) {
  if (typeof name !== "string" || !name || name.length > 255) return false;
  const parts = name.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return false;
  if (list !== "config_files" && parts.length !== 1) return false;
  const lower = name.toLowerCase();
  if (list === "mods") return lower.endsWith(".jar");
  if (list === "resourcepacks" || list === "shaderpacks") return lower.endsWith(".zip");
  return true;
}

/** Una URL es válida si apunta a Modrinth o a un archivo nuestro que existe con ese hash y tamaño. */
async function checkFileUrl(env, origin, rawUrl, sha1, size) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname === MODRINTH_CDN) return true;
  if (u.origin !== origin || u.pathname !== `/files/${sha1}` || u.search) return false;
  const obj = await env.BUCKET.head(`files/${sha1}`);
  return obj !== null && (size === undefined || obj.size === size);
}

async function createPack(request, env, origin) {
  const uuid = await requireAdmin(request, env);
  const lim = limits(env);
  const text = await request.text();
  if (text.length > MAX_MANIFEST_BYTES) throw new HttpError(413, "el manifiesto es demasiado grande");
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new HttpError(400, "manifiesto inválido");
  }
  const bad = (msg) => {
    throw new HttpError(400, msg);
  };
  if (typeof manifest !== "object" || manifest === null) bad("manifiesto inválido");
  if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 48) bad("nombre inválido");
  if (typeof manifest.minecraft_version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(manifest.minecraft_version)) {
    bad("versión de Minecraft inválida");
  }
  if (!["vanilla", "fabric"].includes(manifest.loader)) bad("loader inválido");
  if (manifest.description != null && (typeof manifest.description !== "string" || manifest.description.length > 300)) {
    bad("descripción inválida");
  }

  let count = 0;
  for (const list of FILE_LISTS) {
    const files = manifest[list] ?? [];
    if (!Array.isArray(files)) bad(`${list} inválido`);
    for (const f of files) {
      if (++count > MAX_MANIFEST_FILES) bad("demasiados archivos");
      if (!validFileName(f?.file_name, list)) bad(`${list}: nombre de archivo inválido`);
      if (typeof f.sha1 !== "string" || !SHA1_RE.test(f.sha1)) bad(`${list}/${f.file_name}: SHA-1 inválido`);
      if (!Number.isInteger(f.size) || f.size < 0) bad(`${list}/${f.file_name}: tamaño inválido`);
      if (!(await checkFileUrl(env, origin, f.url, f.sha1, f.size))) {
        bad(`${list}/${f.file_name}: el archivo no se ha subido o su URL no está permitida`);
      }
    }
  }
  if (manifest.background_url != null) {
    const m = String(manifest.background_url).match(/\/files\/([0-9a-f]{40})$/);
    if (!m || !(await checkFileUrl(env, origin, manifest.background_url, m[1]))) {
      bad("la imagen no se ha subido a este servidor");
    }
  }

  const quota = await readQuota(env, uuid);
  if (quota.data.packs >= lim.dailyPacks) throw new HttpError(429, "has alcanzado el límite de packs de hoy");

  let code = null;
  for (let i = 0; i < 16 && !code; i++) {
    const rnd = crypto.getRandomValues(new Uint8Array(6));
    const candidate = `OBS-${[...rnd].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
    if (!(await env.BUCKET.head(`packs/${candidate}.json`))) code = candidate;
  }
  if (!code) throw new HttpError(503, "no se pudo generar un código; inténtalo de nuevo");

  manifest.code = code;
  await env.BUCKET.put(`packs/${code}.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { owner: uuid, created: new Date().toISOString() },
  });
  quota.data.packs += 1;
  await writeQuota(env, quota);
  return json({ code }, 201);
}

async function deletePack(request, env, code) {
  const uuid = await requireAdmin(request, env);
  if (!CODE_RE.test(code)) throw new HttpError(400, "código inválido");
  const key = `packs/${code}.json`;
  const obj = await env.BUCKET.head(key);
  if (!obj) throw new HttpError(404, "no existe ningún pack con ese código");
  const events = await readEvents(env);
  if (events.items.some((e) => e.pack_code === code)) {
    throw new HttpError(409, "un evento usa este pack; quítalo del evento antes de borrarlo");
  }
  await env.BUCKET.delete(key);
  return new Response(null, { status: 204 });
}

/** El manifiesto completo de un pack (para editar sus mods desde el panel web). */
async function adminGetPack(request, env, code) {
  await requireAdmin(request, env);
  const pack = await readPack(env, code);
  if (!pack) throw new HttpError(404, "no existe ningún pack con ese código");
  return json(pack, 200, { "cache-control": "no-store" });
}

// ───────────────────────────── Administradores ─────────────────────────────

function isAdmin(env, uuid) {
  return String(env.ADMIN_UUIDS ?? "")
    .split(",")
    .map((u) => u.trim().replace(/-/g, "").toLowerCase())
    .filter(Boolean)
    .includes(uuid);
}

// ───────────────────────────── Rangos ─────────────────────────────

const level = (rank) => RANKS.indexOf(rank);

async function readMembers(env) {
  const obj = await env.BUCKET.get(MEMBERS_KEY);
  const data = obj ? await obj.json().catch(() => null) : null;
  return Array.isArray(data?.items) ? data : { items: [] };
}

const writeMembers = (env, members) => env.BUCKET.put(MEMBERS_KEY, JSON.stringify(members));

/**
 * Rango de una cuenta: el de la lista de miembros; si no tiene, Owner para
 * ADMIN_UUIDS e Invitado para el resto. El panel web puede cambiar también a
 * las cuentas de ADMIN_UUIDS: su rango guardado manda sobre el de wrangler.toml.
 */
function rankIn(env, members, uuid) {
  const rank = members.items.find((m) => m.uuid === uuid)?.rank;
  if (RANKS.includes(rank)) return rank;
  return isAdmin(env, uuid) ? "owner" : "invitado";
}

/** Quién hace la petición y con qué rango. El panel web (contraseña) es owner. */
async function requireActor(request, env) {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith(`Bearer ${WEB_ADMIN}.`)) {
    await requireWebSession(env, auth.slice(7));
    return { id: WEB_ADMIN, rank: "owner", members: await readMembers(env) };
  }
  const uuid = await requireUser(request, env);
  const members = await readMembers(env);
  return { id: uuid, rank: rankIn(env, members, uuid), members };
}

async function requireRank(request, env, min) {
  const actor = await requireActor(request, env);
  if (level(actor.rank) < level(min)) {
    throw new HttpError(403, `necesitas el rango ${RANK_NAMES[min]} o superior para hacer esto`);
  }
  return actor;
}

/** Crear y editar eventos y packs: Developer o superior. Devuelve quién lo hace. */
async function requireAdmin(request, env) {
  return (await requireRank(request, env, "developer")).id;
}

/** Rangos que puede dar `actor`: owner cualquiera; el resto, solo inferiores al suyo. */
const assignableBy = (actor) => (actor.rank === "owner" ? [...RANKS] : RANKS.filter((r) => level(r) < level(actor.rank)));

function permissionsOf(rank) {
  const l = level(rank);
  return {
    manage_whitelist: l >= level("staff"),
    manage_ranks: l >= level("staff"),
    manage_events: l >= level("developer"),
    assignable: assignableBy({ rank }),
  };
}

/** ¿Puede `actor` tocar a esta cuenta (quitarla de una whitelist, cambiar su rango)? */
function checkCanActOn(env, actor, uuid) {
  if (actor.rank === "owner") return;
  if (level(rankIn(env, actor.members, uuid)) >= level(actor.rank)) {
    throw new HttpError(403, "no puedes cambiar a alguien con tu rango o superior");
  }
}

function checkRankChange(env, actor, uuid, rank) {
  if (!RANKS.includes(rank)) throw new HttpError(400, `rango inválido: ${rank}`);
  // El panel web (contraseña) puede cambiar el rango de cualquiera, también ADMIN_UUIDS.
  if (actor.id === WEB_ADMIN) return;
  if (isAdmin(env, uuid)) {
    throw new HttpError(403, "esa cuenta está en ADMIN_UUIDS: su rango solo se cambia desde el panel web");
  }
  checkCanActOn(env, actor, uuid);
  if (!assignableBy(actor).includes(rank)) {
    throw new HttpError(403, `no puedes dar el rango ${RANK_NAMES[rank]}: solo rangos inferiores al tuyo`);
  }
}

/**
 * Aplica un rango ya comprobado. Invitado es el rango por defecto y no se
 * guarda, salvo para ADMIN_UUIDS (si no, volverían a ser Owner).
 */
function applyRank(env, members, uuid, name, rank, by) {
  const old = members.items.find((m) => m.uuid === uuid);
  members.items = members.items.filter((m) => m.uuid !== uuid);
  if (rank !== "invitado" || isAdmin(env, uuid)) {
    members.items.push({ uuid, name: name ?? old?.name ?? null, rank, updated: new Date().toISOString(), updated_by: by });
  }
  if (members.items.length > MAX_MEMBERS) throw new HttpError(507, `no se pueden tener más de ${MAX_MEMBERS} miembros con rango`);
}

/** La whitelist de un evento con el rango de cada jugador. */
const withRanks = (env, members, players) => (players ?? []).map((p) => ({ ...p, rank: rankIn(env, members, p.uuid) }));

const eventWithRanks = (env, members, event) => ({ ...event, players: withRanks(env, members, event.players) });

/** Nombre conocido de una cuenta (miembros o whitelists), para los owners fijos. */
function knownName(members, events, uuid) {
  return (
    members.items.find((m) => m.uuid === uuid)?.name ??
    events.items.flatMap((e) => e.players ?? []).find((p) => p.uuid === uuid)?.name ??
    null
  );
}

function fixedOwners(env) {
  return String(env.ADMIN_UUIDS ?? "")
    .split(",")
    .map((u) => u.trim().replace(/-/g, "").toLowerCase())
    .filter((u) => UUID_RE.test(u));
}

async function adminListMembers(request, env) {
  const actor = await requireRank(request, env, "staff");
  const events = await readEvents(env);
  const fixed = fixedOwners(env).map((uuid) => ({ uuid, name: knownName(actor.members, events, uuid), rank: rankIn(env, actor.members, uuid), fixed: true }));
  const members = actor.members.items.filter((m) => !isAdmin(env, m.uuid) && RANKS.includes(m.rank));
  members.sort((a, b) => level(b.rank) - level(a.rank) || a.name.localeCompare(b.name));
  return json(
    { me: { id: actor.id, rank: actor.rank }, assignable: assignableBy(actor), members: [...fixed, ...members] },
    200,
    { "cache-control": "no-store" },
  );
}

async function adminSetMember(request, env, rawUuid) {
  const actor = await requireRank(request, env, "staff");
  const uuid = rawUuid.replace(/-/g, "").toLowerCase();
  if (!UUID_RE.test(uuid)) throw new HttpError(400, "UUID inválido");
  const body = await request.json().catch(() => null);
  // El nombre es opcional si la cuenta ya es conocida (p. ej. ADMIN_UUIDS sin nombre todavía).
  let name = body?.name == null || body.name === "" ? null : String(body.name);
  if (name !== null && !MC_NAME_RE.test(name)) throw new HttpError(400, `nombre inválido: ${name}`);
  if (name === null) {
    name = knownName(actor.members, await readEvents(env), uuid);
    if (name === null && !isAdmin(env, uuid)) throw new HttpError(400, "falta el nombre de Minecraft de la cuenta");
  }
  const rank = String(body?.rank ?? "");
  checkRankChange(env, actor, uuid, rank);
  applyRank(env, actor.members, uuid, name, rank, actor.id);
  await writeMembers(env, actor.members);
  return json({ uuid, name, rank });
}

async function adminRemoveMember(request, env, rawUuid) {
  const actor = await requireRank(request, env, "staff");
  const uuid = rawUuid.replace(/-/g, "").toLowerCase();
  if (!UUID_RE.test(uuid)) throw new HttpError(400, "UUID inválido");
  checkRankChange(env, actor, uuid, "invitado");
  applyRank(env, actor.members, uuid, null, "invitado", actor.id);
  await writeMembers(env, actor.members);
  return new Response(null, { status: 204 });
}

function cleanText(value, max) {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError(400, "texto inválido");
  // eslint-disable-next-line no-control-regex
  const t = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
  if (t.length > max) throw new HttpError(400, `el texto no puede pasar de ${max} caracteres`);
  return t || null;
}

const dashed = (u) => u.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

// ───────────────────────────── Eventos ─────────────────────────────
//
// Un único índice JSON (`events/index.json`) con los eventos y su whitelist.
// Sirve igual para KV y R2. Pensado para un equipo pequeño de admins: dos
// cambios exactamente simultáneos podrían pisarse.

async function readEvents(env) {
  const obj = await env.BUCKET.get(EVENTS_KEY);
  if (!obj) return { items: [] };
  const data = await obj.json().catch(() => null);
  return Array.isArray(data?.items) ? data : { items: [] };
}

const writeEvents = (env, events) => env.BUCKET.put(EVENTS_KEY, JSON.stringify(events));

function findEvent(events, id) {
  if (!EVENT_ID_RE.test(id)) throw new HttpError(400, "identificador de evento inválido");
  const event = events.items.find((e) => e.id === id);
  if (!event) throw new HttpError(404, "ese evento no existe");
  return event;
}

async function readPack(env, code) {
  const obj = await env.BUCKET.get(`packs/${code}.json`);
  if (!obj) return null;
  return obj.json().catch(() => null);
}

/** Lo que ve un jugador de la whitelist: incluye la dirección y el pack completo. */
async function playerView(env, event) {
  const pack = event.pack_code ? await readPack(env, event.pack_code) : null;
  return {
    id: event.id,
    name: event.name,
    description: event.description ?? null,
    minecraft_version: event.minecraft_version,
    loader: event.loader,
    loader_version: event.loader_version ?? null,
    server_address: event.server_address ?? null,
    memory: event.memory ?? null,
    image_url: event.image_url ?? null,
    active: event.active !== false,
    manifest: pack
      ? {
          code: event.id,
          name: event.name,
          description: event.description ?? null,
          background_url: event.image_url ?? pack.background_url ?? null,
          minecraft_version: event.minecraft_version,
          loader: event.loader,
          loader_version: event.loader_version ?? null,
          java: pack.java ?? null,
          memory: event.memory ?? pack.memory ?? null,
          mods: pack.mods ?? [],
          resourcepacks: pack.resourcepacks ?? [],
          shaderpacks: pack.shaderpacks ?? [],
          config_files: pack.config_files ?? [],
        }
      : null,
    updated: event.updated ?? null,
  };
}

async function listMyEvents(request, env) {
  const uuid = await requireUser(request, env);
  const rank = rankIn(env, await readMembers(env), uuid);
  // El equipo (Staff o superior) ve y puede entrar a todos los eventos, también los cerrados.
  const team = level(rank) >= level("staff");
  const events = await readEvents(env);
  const mine = events.items.filter(
    (e) => team || (e.active !== false && (e.players ?? []).some((p) => p.uuid === uuid)),
  );
  return json(
    {
      uuid,
      rank,
      admin: team,
      permissions: permissionsOf(rank),
      events: await Promise.all(mine.map((e) => playerView(env, e))),
    },
    200,
    { "cache-control": "no-store" },
  );
}

async function adminListEvents(request, env) {
  const actor = await requireRank(request, env, "staff");
  const events = await readEvents(env);
  return json(
    { events: events.items.map((e) => eventWithRanks(env, actor.members, e)) },
    200,
    { "cache-control": "no-store" },
  );
}

function parseMemory(value) {
  if (value == null) return null;
  const min = Number(value.min_mb);
  const max = Number(value.max_mb);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 512 || max < min || max > 65536) {
    throw new HttpError(400, "memoria inválida (mínimo 512 MB y máximo ≥ mínimo)");
  }
  return { min_mb: min, max_mb: max };
}

function newEventId() {
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  return `EVT-${[...rnd].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
}

async function adminSaveEvent(request, env, id) {
  const uuid = await requireAdmin(request, env);
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) throw new HttpError(400, "petición inválida");
  const events = await readEvents(env);

  let event;
  if (id) {
    event = findEvent(events, id);
  } else {
    if (events.items.length >= MAX_EVENTS) throw new HttpError(507, `no se pueden tener más de ${MAX_EVENTS} eventos`);
    let fresh = newEventId();
    while (events.items.some((e) => e.id === fresh)) fresh = newEventId();
    event = { id: fresh, players: [], created: new Date().toISOString(), created_by: uuid };
    events.items.unshift(event);
  }

  const name = cleanText(body.name, 48);
  if (!name) throw new HttpError(400, "falta el nombre del evento");
  const description = cleanText(body.description, 600);

  const serverAddress = cleanText(body.server_address, 260);
  if (serverAddress) {
    const port = Number(serverAddress.split(":")[1] ?? 25565);
    if (!SERVER_ADDRESS_RE.test(serverAddress) || !(port >= 1 && port <= 65535)) {
      throw new HttpError(400, "dirección del servidor inválida (usa host o host:puerto)");
    }
  }

  let imageUrl = cleanText(body.image_url, 500);
  if (imageUrl) {
    let u;
    try {
      u = new URL(imageUrl);
    } catch {
      throw new HttpError(400, "la URL de la imagen no es válida");
    }
    if (u.protocol !== "https:") throw new HttpError(400, "la imagen debe ser https");
  }

  // Con pack, la versión y el loader salen del pack (no pueden no coincidir).
  const packCode = cleanText(body.pack_code, 16)?.toUpperCase() ?? null;
  let version, loader, loaderVersion;
  if (packCode) {
    if (!CODE_RE.test(packCode)) throw new HttpError(400, "código de pack inválido (OBS-XXXXXX)");
    const pack = await readPack(env, packCode);
    if (!pack) throw new HttpError(404, "ese pack no existe en este servidor; súbelo antes desde Obsidia");
    version = pack.minecraft_version;
    loader = pack.loader;
    loaderVersion = pack.loader_version ?? null;
    imageUrl = imageUrl ?? pack.background_url ?? null;
  } else {
    version = String(body.minecraft_version ?? "");
    loader = body.loader ?? "vanilla";
    loaderVersion = body.loader_version ?? null;
  }
  if (!MC_VERSION_RE.test(version)) throw new HttpError(400, "versión de Minecraft inválida");
  if (!["vanilla", "fabric"].includes(loader)) throw new HttpError(400, "loader inválido");
  if (loader === "fabric" && !(typeof loaderVersion === "string" && LOADER_VERSION_RE.test(loaderVersion))) {
    throw new HttpError(400, "falta la versión de Fabric Loader");
  }
  if (loader === "vanilla") loaderVersion = null;

  Object.assign(event, {
    name,
    description,
    server_address: serverAddress,
    image_url: imageUrl,
    pack_code: packCode,
    minecraft_version: version,
    loader,
    loader_version: loaderVersion,
    memory: parseMemory(body.memory),
    active: body.active !== false,
    updated: new Date().toISOString(),
  });
  await writeEvents(env, events);
  return json(eventWithRanks(env, await readMembers(env), event), id ? 200 : 201);
}

async function adminDeleteEvent(request, env, id) {
  await requireAdmin(request, env);
  const events = await readEvents(env);
  findEvent(events, id);
  events.items = events.items.filter((e) => e.id !== id);
  await writeEvents(env, events);
  return new Response(null, { status: 204 });
}

/**
 * Añade jugadores a la whitelist (Staff o superior). Cada uno puede llevar
 * `rank`: si cambia su rango global, se comprueba que quien lo pide pueda darlo.
 * Todo se valida antes de guardar nada: o entran todos o ninguno.
 */
async function adminAddPlayers(request, env, id) {
  const actor = await requireRank(request, env, "staff");
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.players) ? body.players : null;
  if (!list || list.length === 0 || list.length > 500) throw new HttpError(400, "envía entre 1 y 500 jugadores");
  const events = await readEvents(env);
  const event = findEvent(events, id);
  event.players ??= [];

  const parsed = list.map((p) => {
    const uuid = String(p?.uuid ?? "").replace(/-/g, "").toLowerCase();
    const name = String(p?.name ?? "");
    if (!UUID_RE.test(uuid)) throw new HttpError(400, `UUID inválido: ${p?.uuid}`);
    if (!MC_NAME_RE.test(name)) throw new HttpError(400, `nombre inválido: ${name}`);
    const rank = p?.rank == null ? null : String(p.rank);
    if (rank !== null && rank !== rankIn(env, actor.members, uuid)) {
      try {
        checkRankChange(env, actor, uuid, rank);
      } catch (e) {
        if (e instanceof HttpError) throw new HttpError(e.status, `${name}: ${e.message}`);
        throw e;
      }
    }
    return { uuid, name, rank };
  });

  let ranksChanged = false;
  for (const { uuid, name, rank } of parsed) {
    const existing = event.players.find((x) => x.uuid === uuid);
    if (existing) existing.name = name;
    else event.players.push({ uuid, name, added: new Date().toISOString(), added_by: actor.id });
    if (rank !== null && rank !== rankIn(env, actor.members, uuid)) {
      applyRank(env, actor.members, uuid, name, rank, actor.id);
      ranksChanged = true;
    }
  }
  if (event.players.length > MAX_PLAYERS_PER_EVENT) {
    throw new HttpError(507, `un evento no puede tener más de ${MAX_PLAYERS_PER_EVENT} jugadores`);
  }
  event.updated = new Date().toISOString();
  if (ranksChanged) await writeMembers(env, actor.members);
  await writeEvents(env, events);
  return json({ players: withRanks(env, actor.members, event.players) });
}

async function adminRemovePlayer(request, env, id, rawUuid) {
  const actor = await requireRank(request, env, "staff");
  const uuid = rawUuid.replace(/-/g, "").toLowerCase();
  if (!UUID_RE.test(uuid)) throw new HttpError(400, "UUID inválido");
  checkCanActOn(env, actor, uuid);
  const events = await readEvents(env);
  const event = findEvent(events, id);
  event.players = (event.players ?? []).filter((p) => p.uuid !== uuid);
  event.updated = new Date().toISOString();
  await writeEvents(env, events);
  return json({ players: withRanks(env, actor.members, event.players) });
}

// ───────────────────────────── Panel web ─────────────────────────────

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://meta.fabricmc.net https://api.modrinth.com; img-src 'self' data: https://cdn.modrinth.com; " +
  "form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; require-trusted-types-for 'script'";

function page(body, type) {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-security-policy": PAGE_CSP,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "cache-control": "no-store",
    },
  });
}

/** Compara dos secretos sin filtrar su longitud ni su contenido por tiempos. */
async function sameSecret(env, given, expected) {
  return safeEqual(await hmac(env, `cmp:${given}`), await hmac(env, `cmp:${expected}`));
}

/**
 * Huella de la contraseña dentro del token web: si se cambia ADMIN_PASSWORD,
 * todas las sesiones abiertas dejan de valer.
 */
async function passwordFingerprint(env, password) {
  return (await hmac(env, `pwfp:${password}`)).slice(0, 16);
}

/** Identificador de la IP para el bloqueo por fuerza bruta (no se guarda la IP en claro). */
async function clientKey(env, request) {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  return (await hmac(env, `ip:${ip}`)).slice(0, 22);
}

const tooManyAttempts = (seconds) =>
  new HttpError(
    429,
    `demasiados intentos fallidos; espera ${Math.max(1, Math.ceil(seconds / 60))} min antes de volver a probar`,
    { "retry-after": String(Math.max(1, Math.ceil(seconds))) },
  );

async function webLogin(request, env) {
  const expected = String(env.ADMIN_PASSWORD ?? "");
  if (expected.length < 12) {
    throw new HttpError(503, "falta configurar ADMIN_PASSWORD (wrangler secret put ADMIN_PASSWORD, 12+ caracteres)");
  }
  const now = Math.floor(Date.now() / 1000);
  const ipKey = await clientKey(env, request);

  // Límite rápido de Cloudflare si está configurado (LOGIN_LIMITER en wrangler.toml).
  if (env.LOGIN_LIMITER) {
    const { success } = await env.LOGIN_LIMITER.limit({ key: ipKey });
    if (!success) throw tooManyAttempts(60);
  }

  // Bloqueo persistente: cuenta los fallos de cada IP.
  const failKey = `web/fails/${ipKey}`;
  const failObj = await env.BUCKET.get(failKey);
  let fails = failObj ? await failObj.json().catch(() => null) : null;
  if (fails?.locked_until > now) throw tooManyAttempts(fails.locked_until - now);
  if (!(fails?.window_end > now)) fails = { count: 0, window_end: now + LOGIN_WINDOW_S, locked_until: 0 };

  const body = await readSmallJson(request, MAX_WEB_LOGIN_BODY);
  const given = String(body?.password ?? "");
  if (!(await sameSecret(env, given, expected))) {
    fails.count += 1;
    if (fails.count >= LOGIN_MAX_FAILS) fails.locked_until = now + LOGIN_LOCK_S;
    await env.BUCKET.put(failKey, JSON.stringify(fails), {
      expirationTtl: Math.max(fails.window_end, fails.locked_until) - now,
    });
    if (fails.locked_until > now) throw tooManyAttempts(LOGIN_LOCK_S);
    const left = LOGIN_MAX_FAILS - fails.count;
    throw new HttpError(401, `contraseña incorrecta (te quedan ${left} intento${left === 1 ? "" : "s"})`);
  }
  if (failObj) await env.BUCKET.delete(failKey);

  const sid = hex(crypto.getRandomValues(new Uint8Array(12)));
  const fp = await passwordFingerprint(env, expected);
  return json({ token: await sign(env, "webadmin", [WEB_ADMIN, sid, fp], WEB_TOKEN_TTL_S) }, 200, {
    "cache-control": "no-store",
  });
}

// Sesiones web: el token es stateless (firmado), pero se puede revocar.
//   - «Salir» apunta su id en `revoked` hasta que caduca.
//   - «Cerrar todas las sesiones» mueve `not_before`: los tokens emitidos antes dejan de valer.
async function readWebSessions(env) {
  const obj = await env.BUCKET.get(WEB_SESSIONS_KEY);
  const d = obj ? await obj.json().catch(() => null) : null;
  return {
    not_before: Number(d?.not_before) || 0,
    revoked: d?.revoked && typeof d.revoked === "object" ? d.revoked : {},
  };
}

async function writeWebSessions(env, sessions) {
  const now = Date.now() / 1000;
  for (const [sid, exp] of Object.entries(sessions.revoked)) if (!(exp > now)) delete sessions.revoked[sid];
  await env.BUCKET.put(WEB_SESSIONS_KEY, JSON.stringify(sessions));
}

async function requireWebSession(env, token) {
  const [, sid, fp] = await verify(env, "webadmin", token, 3);
  const exp = Number(token.split(".")[3]);
  const password = String(env.ADMIN_PASSWORD ?? "");
  if (password.length < 12 || !safeEqual(fp, await passwordFingerprint(env, password))) {
    throw new HttpError(401, "la contraseña del panel ha cambiado; vuelve a entrar");
  }
  const sessions = await readWebSessions(env);
  if (sessions.revoked[sid] || exp - WEB_TOKEN_TTL_S <= sessions.not_before) {
    throw new HttpError(401, "la sesión se ha cerrado; vuelve a entrar");
  }
  return { sid, exp };
}

/** Cierra la sesión web actual en el servidor (no solo en el navegador). */
async function webLogout(request, env) {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith(`Bearer ${WEB_ADMIN}.`)) {
    const session = await requireWebSession(env, auth.slice(7)).catch(() => null);
    if (session) {
      const sessions = await readWebSessions(env);
      sessions.revoked[session.sid] = session.exp;
      await writeWebSessions(env, sessions);
    }
  }
  return new Response(null, { status: 204 });
}

/** Cierra todas las sesiones del panel web (por ejemplo, si se perdió un portátil). */
async function webLogoutAll(request, env) {
  await requireRank(request, env, "owner");
  const sessions = await readWebSessions(env);
  sessions.not_before = Math.floor(Date.now() / 1000);
  sessions.revoked = {};
  await writeWebSessions(env, sessions);
  return new Response(null, { status: 204 });
}

/** Nombre o UUID → { uuid, name }. Mojang suele bloquear a Cloudflare, así que hay respaldo. */
async function adminResolve(request, env, url) {
  await requireRank(request, env, "staff");
  const q = String(url.searchParams.get("q") ?? "").trim();
  const uuidQuery = q.replace(/-/g, "").toLowerCase();
  const isUuid = UUID_RE.test(uuidQuery);
  if (!isUuid && !MC_NAME_RE.test(q)) throw new HttpError(400, "no es un nombre de Minecraft ni un UUID");

  const sources = isUuid
    ? [
        [`https://sessionserver.mojang.com/session/minecraft/profile/${uuidQuery}`, (d) => d],
        [`https://playerdb.co/api/player/minecraft/${uuidQuery}`, (d) => d?.data?.player && { id: d.data.player.raw_id, name: d.data.player.username }],
      ]
    : [
        [`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(q)}`, (d) => d],
        [`https://playerdb.co/api/player/minecraft/${encodeURIComponent(q)}`, (d) => d?.data?.player && { id: d.data.player.raw_id, name: d.data.player.username }],
      ];
  let notFound = false;
  for (const [src, pick] of sources) {
    try {
      const res = await fetch(src, { headers: { accept: "application/json", "user-agent": "obsidia-eventos" } });
      if (res.status === 204 || res.status === 404 || (res.status === 400 && src.includes("playerdb"))) {
        notFound = true;
        continue;
      }
      if (!res.ok) continue;
      const p = pick(await res.json());
      const uuid = String(p?.id ?? "").replace(/-/g, "").toLowerCase();
      if (UUID_RE.test(uuid) && MC_NAME_RE.test(String(p?.name ?? ""))) return json({ uuid, name: p.name });
    } catch {
      // probar la siguiente fuente
    }
  }
  if (notFound) throw new HttpError(404, "no existe esa cuenta de Minecraft");
  throw new HttpError(502, "no se pudo consultar a Mojang ahora mismo; prueba otra vez");
}

// ───────────────────────────── Servidor de Minecraft ─────────────────────────────
//
// El launcher no basta para proteger un evento: cualquiera que conozca la IP
// podría entrar con otro launcher. El servidor de Minecraft debe tener su
// propia whitelist; esta ruta se la da ya hecha (formato `whitelist.json`)
// para sincronizarla con un cron o un plugin.

async function serverWhitelist(request, env, url, id) {
  const expected = String(env.SERVER_KEY ?? "");
  if (expected.length < 24) throw new HttpError(503, "falta configurar SERVER_KEY (wrangler secret put SERVER_KEY)");
  // Solo en la cabecera: en la URL (?key=) acabaría en registros e historiales.
  const auth = request.headers.get("authorization") ?? "";
  if (url.searchParams.has("key")) {
    throw new HttpError(400, "la clave va en la cabecera Authorization: Bearer <SERVER_KEY>, no en la URL");
  }
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !(await sameSecret(env, given, expected))) throw new HttpError(401, "clave de servidor incorrecta");
  const events = await readEvents(env);
  const event = findEvent(events, id);
  // La whitelist del evento más el equipo (Staff o superior), que entra a todos.
  const members = await readMembers(env);
  const byUuid = new Map();
  for (const p of event.players ?? []) byUuid.set(p.uuid, p.name);
  const team = new Set([...members.items.map((m) => m.uuid), ...fixedOwners(env)]);
  for (const uuid of team) {
    if (level(rankIn(env, members, uuid)) < level("staff")) continue;
    const name = knownName(members, events, uuid);
    if (name) byUuid.set(uuid, name);
  }
  const list = [...byUuid].map(([uuid, name]) => ({ uuid: dashed(uuid), name }));
  return json(list, 200, { "cache-control": "no-store" });
}
