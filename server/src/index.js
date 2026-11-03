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
// Administración (UUID en ADMIN_UUIDS):
//   GET    /api/admin/events                      todos los eventos con su whitelist
//   POST   /api/admin/events                      crear evento
//   PUT    /api/admin/events/<EVT-XXXXXX>         editar evento
//   DELETE /api/admin/events/<EVT-XXXXXX>         borrar evento
//   POST   /api/admin/events/<id>/players         { players: [{ uuid, name }] } añadir a la whitelist
//   DELETE /api/admin/events/<id>/players/<uuid>  quitar de la whitelist
//   PUT    /api/files/<sha1>, POST /api/packs     subir el pack del evento (desde Obsidia normal)
//   DELETE /api/packs/<code>
//
// Panel web (contraseña ADMIN_PASSWORD):
//   GET  /admin                                  la página del panel
//   POST /api/admin/web-login    { password }    -> { token } sesión web de admin (12 h)
//   GET  /api/admin/resolve?q=<nombre|uuid>      -> { uuid, name } (admin)
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

const WEB_TOKEN_TTL_S = 12 * 60 * 60;
const WEB_ADMIN = "web";

const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      // R2 si está configurado (pide tarjeta, aunque sea gratis); si no, Workers KV.
      if (!env.BUCKET && env.FILES) env = { ...env, BUCKET: kvBucket(env.FILES), USING_KV: true };
      if (!env.BUCKET) throw new HttpError(500, "falta configurar el almacenamiento (FILES o BUCKET en wrangler.toml)");
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "error interno del servidor" }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
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
      await kv.put(key, bytes, { metadata: { size: bytes.byteLength, custom: opts.customMetadata ?? {} } });
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
  if (path === "/api/admin/resolve" && method === "GET") return adminResolve(request, env, url);

  let m = path.match(/^\/files\/([0-9a-f]{40})$/);
  if (m && (method === "GET" || method === "HEAD")) {
    const key = `files/${m[1]}`;
    const obj = method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : obj.body, {
      headers: {
        "content-type": "application/octet-stream",
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

  if (path === "/api/admin/events" && method === "GET") return adminListEvents(request, env);
  if (path === "/api/admin/events" && method === "POST") return adminSaveEvent(request, env, null);
  m = path.match(/^\/api\/admin\/events\/(EVT-[A-Z0-9]{6})$/);
  if (m && method === "PUT") return adminSaveEvent(request, env, m[1]);
  if (m && method === "DELETE") return adminDeleteEvent(request, env, m[1]);
  m = path.match(/^\/api\/admin\/events\/(EVT-[A-Z0-9]{6})\/players$/);
  if (m && method === "POST") return adminAddPlayers(request, env, m[1]);
  m = path.match(/^\/api\/admin\/events\/(EVT-[A-Z0-9]{6})\/players\/([0-9a-fA-F-]{32,36})$/);
  if (m && method === "DELETE") return adminRemovePlayer(request, env, m[1], m[2]);

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
  const body = await request.json().catch(() => null);
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

// ───────────────────────────── Administradores ─────────────────────────────

function isAdmin(env, uuid) {
  return String(env.ADMIN_UUIDS ?? "")
    .split(",")
    .map((u) => u.trim().replace(/-/g, "").toLowerCase())
    .filter(Boolean)
    .includes(uuid);
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith(`Bearer ${WEB_ADMIN}.`)) {
    await verify(env, "webadmin", auth.slice(7), 1);
    return WEB_ADMIN;
  }
  const uuid = await requireUser(request, env);
  if (!isAdmin(env, uuid)) throw new HttpError(403, "solo los administradores del evento pueden hacer esto");
  return uuid;
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
  const admin = isAdmin(env, uuid);
  const events = await readEvents(env);
  const mine = events.items.filter(
    (e) => admin || (e.active !== false && (e.players ?? []).some((p) => p.uuid === uuid)),
  );
  return json(
    { uuid, admin, events: await Promise.all(mine.map((e) => playerView(env, e))) },
    200,
    { "cache-control": "no-store" },
  );
}

async function adminListEvents(request, env) {
  await requireAdmin(request, env);
  const events = await readEvents(env);
  return json({ events: events.items }, 200, { "cache-control": "no-store" });
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
  return json(event, id ? 200 : 201);
}

async function adminDeleteEvent(request, env, id) {
  await requireAdmin(request, env);
  const events = await readEvents(env);
  findEvent(events, id);
  events.items = events.items.filter((e) => e.id !== id);
  await writeEvents(env, events);
  return new Response(null, { status: 204 });
}

async function adminAddPlayers(request, env, id) {
  const admin = await requireAdmin(request, env);
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.players) ? body.players : null;
  if (!list || list.length === 0 || list.length > 500) throw new HttpError(400, "envía entre 1 y 500 jugadores");
  const events = await readEvents(env);
  const event = findEvent(events, id);
  event.players ??= [];
  for (const p of list) {
    const uuid = String(p?.uuid ?? "").replace(/-/g, "").toLowerCase();
    const name = String(p?.name ?? "");
    if (!UUID_RE.test(uuid)) throw new HttpError(400, `UUID inválido: ${p?.uuid}`);
    if (!MC_NAME_RE.test(name)) throw new HttpError(400, `nombre inválido: ${name}`);
    const existing = event.players.find((x) => x.uuid === uuid);
    if (existing) existing.name = name;
    else event.players.push({ uuid, name, added: new Date().toISOString(), added_by: admin });
  }
  if (event.players.length > MAX_PLAYERS_PER_EVENT) {
    throw new HttpError(507, `un evento no puede tener más de ${MAX_PLAYERS_PER_EVENT} jugadores`);
  }
  event.updated = new Date().toISOString();
  await writeEvents(env, events);
  return json({ players: event.players });
}

async function adminRemovePlayer(request, env, id, rawUuid) {
  await requireAdmin(request, env);
  const uuid = rawUuid.replace(/-/g, "").toLowerCase();
  if (!UUID_RE.test(uuid)) throw new HttpError(400, "UUID inválido");
  const events = await readEvents(env);
  const event = findEvent(events, id);
  event.players = (event.players ?? []).filter((p) => p.uuid !== uuid);
  event.updated = new Date().toISOString();
  await writeEvents(env, events);
  return json({ players: event.players });
}

// ───────────────────────────── Panel web ─────────────────────────────

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://meta.fabricmc.net; img-src 'self' data:; " +
  "form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function page(body, type) {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-security-policy": PAGE_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  });
}

async function webLogin(request, env) {
  const expected = String(env.ADMIN_PASSWORD ?? "");
  if (expected.length < 12) {
    throw new HttpError(503, "falta configurar ADMIN_PASSWORD (wrangler secret put ADMIN_PASSWORD, 12+ caracteres)");
  }
  const body = await request.json().catch(() => null);
  const given = String(body?.password ?? "");
  // Compara los HMAC (misma longitud siempre) para no filtrar nada por tiempos.
  if (!safeEqual(await hmac(env, `pw:${given}`), await hmac(env, `pw:${expected}`))) {
    throw new HttpError(401, "contraseña incorrecta");
  }
  return json({ token: await sign(env, "webadmin", [WEB_ADMIN], WEB_TOKEN_TTL_S) }, 200, { "cache-control": "no-store" });
}

/** Nombre o UUID → { uuid, name }. Mojang suele bloquear a Cloudflare, así que hay respaldo. */
async function adminResolve(request, env, url) {
  await requireAdmin(request, env);
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
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : (url.searchParams.get("key") ?? "");
  if (!safeEqual(given, expected)) throw new HttpError(401, "clave de servidor incorrecta");
  const events = await readEvents(env);
  const event = findEvent(events, id);
  const list = (event.players ?? []).map((p) => ({ uuid: dashed(p.uuid), name: p.name }));
  return json(list, 200, { "cache-control": "no-store" });
}
