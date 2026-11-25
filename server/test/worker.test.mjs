// Pruebas del Worker sin Cloudflare: almacenamiento en memoria y claves de Mojang simuladas.
// Ejecutar con `node --test server/test/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../src/index.js";

const ORIGIN = "https://share.example.com";
const UUID = "0123456789abcdef0123456789abcdef"; // admin
const PLAYER = "fedcba9876543210fedcba9876543210"; // jugador normal
const SERVER_KEY = "k".repeat(32);

function memoryBucket() {
  const store = new Map();
  const obj = (v) => ({
    size: v.bytes.byteLength,
    customMetadata: v.customMetadata,
    body: v.bytes,
    json: async () => JSON.parse(new TextDecoder().decode(v.bytes)),
  });
  return {
    store,
    async head(k) {
      return store.has(k) ? obj(store.get(k)) : null;
    },
    async get(k) {
      return store.has(k) ? obj(store.get(k)) : null;
    },
    async put(k, value, opts = {}) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
      store.set(k, { bytes, customMetadata: opts.customMetadata });
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

// Workers KV en memoria (solo lo que usa el adaptador del Worker).
function memoryKv() {
  const store = new Map();
  return {
    store,
    async getWithMetadata(k) {
      const v = store.get(k);
      return v ? { value: v.value.buffer.slice(0), metadata: v.metadata } : { value: null, metadata: null };
    },
    async put(k, value, opts = {}) {
      store.set(k, { value: new Uint8Array(value), metadata: structuredClone(opts.metadata ?? null) });
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

// `STORAGE=kv node --test test/` prueba el modo sin tarjeta (Workers KV).
const USE_KV = process.env.STORAGE === "kv";

function makeEnv() {
  const base = {
    SECRET: "x".repeat(40),
    MAX_FILE_MB: "1",
    MOJANG_PLAYER_KEYS: MOJANG_KEY_B64,
    ADMIN_UUIDS: UUID,
    SERVER_KEY: SERVER_KEY,
  };
  return USE_KV ? { ...base, FILES: memoryKv() } : { ...base, BUCKET: memoryBucket() };
}

// El Worker no debe llamar a ninguna red: todo se verifica con firmas.
globalThis.fetch = async (url) => {
  throw new Error(`fetch inesperado: ${url}`);
};

// "Mojang" de prueba: una clave RSA propia que firma los certificados.
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const mojang = await crypto.subtle.generateKey({ ...RSA, hash: "SHA-1" }, true, ["sign", "verify"]);
const MOJANG_KEY_B64 = b64(await crypto.subtle.exportKey("spki", mojang.publicKey));

/** Certificado de jugador como el de /player/certificates, firmado por `signer`. */
async function playerCertificate({ uuid = UUID, expiresInMs = 3600_000, signer = mojang.privateKey } = {}) {
  const player = await crypto.subtle.generateKey({ ...RSA, hash: "SHA-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", player.publicKey));
  const expires = new Date(Date.now() + expiresInMs);
  // Mojang manda nanosegundos: comprobamos que se truncan como en Java.
  const expiresAt = expires.toISOString().replace("Z", "123456Z");
  const payload = new Uint8Array(24 + spki.length);
  for (let i = 0; i < 16; i++) payload[i] = parseInt(uuid.slice(i * 2, i * 2 + 2), 16);
  new DataView(payload.buffer).setBigInt64(16, BigInt(expires.getTime()));
  payload.set(spki, 24);
  const sigV2 = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, payload);
  return {
    publicKey: `-----BEGIN RSA PUBLIC KEY-----\n${b64(spki)}\n-----END RSA PUBLIC KEY-----\n`,
    publicKeySignatureV2: b64(sigV2),
    expiresAt,
    sign: async (text) =>
      b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", player.privateKey, new TextEncoder().encode(text))),
  };
}

const call = (env, method, path, { body, token, headers = {} } = {}) =>
  worker.fetch(
    new Request(ORIGIN + path, {
      method,
      body,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    }),
    env,
  );

async function loginAs(env, opts = {}) {
  const ch = await (await call(env, "POST", "/api/challenge")).json();
  const cert = await playerCertificate(opts);
  const message = opts.signTicket ?? ch.ticket;
  return call(env, "POST", "/api/login", {
    body: JSON.stringify({
      uuid: opts.claimUuid ?? (opts.uuid ?? UUID).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
      ticket: ch.ticket,
      publicKey: cert.publicKey,
      publicKeySignatureV2: cert.publicKeySignatureV2,
      expiresAt: cert.expiresAt,
      signature: await cert.sign(`obsidia-share-login\n${message}`),
    }),
  });
}

const sha1 = (bytes) => createHash("sha1").update(bytes).digest("hex");

async function upload(env, token, bytes) {
  return call(env, "PUT", `/api/files/${sha1(bytes)}`, {
    body: bytes,
    token,
    headers: { "content-length": String(bytes.byteLength) },
  });
}

function manifest(fileUrl, hash, size) {
  return {
    code: "",
    name: "Pack",
    minecraft_version: "1.21.1",
    loader: "fabric",
    loader_version: "0.16.5",
    memory: { min_mb: 2048, max_mb: 4096 },
    mods: [{ file_name: "privado.jar", url: fileUrl, sha1: hash, size }],
    resourcepacks: [],
    shaderpacks: [],
    config_files: [],
  };
}

test("login con certificado de jugador: acepta el bueno y rechaza los falsos", async () => {
  const env = makeEnv();
  const ok = await loginAs(env);
  assert.equal(ok.status, 200, await ok.clone().text());
  const body = await ok.json();
  assert.equal(body.uuid, UUID);
  assert.ok(body.token);

  const otherSigner = await crypto.subtle.generateKey({ ...RSA, hash: "SHA-1" }, true, ["sign", "verify"]);
  assert.equal((await loginAs(env, { signer: otherSigner.privateKey })).status, 401, "no firmado por Mojang");
  assert.equal((await loginAs(env, { claimUuid: "f".repeat(32) })).status, 401, "UUID ajeno al certificado");
  assert.equal((await loginAs(env, { expiresInMs: -1000 })).status, 401, "certificado caducado");
  assert.equal((await loginAs(env, { signTicket: "otro" })).status, 401, "firma de otro desafío");

  const ch = await (await call(env, "POST", "/api/challenge")).json();
  const forged = await call(env, "POST", "/api/login", {
    body: JSON.stringify({ uuid: UUID, ticket: ch.ticket.replace(/.$/, "A") }),
  });
  assert.equal(forged.status, 401, "ticket manipulado");
});

const tokenOf = async (env, uuid = UUID) => (await (await loginAs(env, { uuid })).json()).token;
const post = (env, path, token, body) => call(env, "POST", path, { token, body: JSON.stringify(body) });

test("solo los admins suben archivos y packs", async () => {
  const env = makeEnv();
  const admin = await tokenOf(env);
  const player = await tokenOf(env, PLAYER);
  const jar = new TextEncoder().encode("contenido de un mod del evento");
  const hash = sha1(jar);

  assert.equal((await call(env, "PUT", `/api/files/${hash}`, { body: jar })).status, 401, "subir requiere sesión");
  assert.equal((await upload(env, player, jar)).status, 403, "un jugador no sube");
  assert.equal((await upload(env, admin, jar)).status, 201);
  assert.equal((await (await upload(env, admin, jar)).json()).existed, true, "dedupe por hash");

  const body = manifest(`${ORIGIN}/files/${hash}`, hash, jar.byteLength);
  assert.equal((await post(env, "/api/packs", player, body)).status, 403);
  const created = await post(env, "/api/packs", admin, body);
  assert.equal(created.status, 201);
  const { code } = await created.json();
  assert.match(code, /^OBS-[A-Z0-9]{6}$/);

  assert.equal((await call(env, "GET", `/${code}.json`)).status, 404, "el manifiesto ya no es público");
  const file = await call(env, "GET", `/files/${hash}`);
  assert.equal(sha1(new Uint8Array(await file.arrayBuffer())), hash);

  assert.equal((await call(env, "DELETE", `/api/packs/${code}`, { token: player })).status, 403);
  assert.equal((await call(env, "DELETE", `/api/packs/${code}`, { token: admin })).status, 204);
});

test("rechaza hashes falsos, archivos grandes y URLs ajenas", async () => {
  const env = makeEnv();
  const token = await tokenOf(env);
  const jar = new TextEncoder().encode("abc");
  const wrongHash = await call(env, "PUT", `/api/files/${"0".repeat(40)}`, {
    body: jar,
    token,
    headers: { "content-length": "3" },
  });
  assert.equal(wrongHash.status, 400);
  assert.equal((await upload(env, token, new Uint8Array(2 * 1024 * 1024))).status, 413);

  const hash = sha1(jar);
  for (const url of [`https://evil.example/files/${hash}`, `${ORIGIN}/files/${hash}`]) {
    assert.equal((await post(env, "/api/packs", token, manifest(url, hash, 3))).status, 400, url);
  }
  const traversal = manifest("https://cdn.modrinth.com/x.jar", hash, 3);
  traversal.mods[0].file_name = "../../evil.jar";
  assert.equal((await post(env, "/api/packs", token, traversal)).status, 400);
});

test("sin almacenamiento configurado responde un error claro", async () => {
  const r = await worker.fetch(new Request(`${ORIGIN}/`), { SECRET: "x".repeat(40) });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /almacenamiento/);
});

test("whitelist: solo ve el evento quien está en la lista", async () => {
  const env = makeEnv();
  const admin = await tokenOf(env);
  const player = await tokenOf(env, PLAYER);

  // Un jugador no puede administrar.
  assert.equal((await call(env, "GET", "/api/admin/events", { token: player })).status, 403);
  assert.equal((await post(env, "/api/admin/events", player, { name: "x", minecraft_version: "1.21.1" })).status, 403);

  const pack = await post(env, "/api/packs", admin, manifest("https://cdn.modrinth.com/data/a/a.jar", "a".repeat(40), 1));
  const { code } = await pack.json();
  const created = await post(env, "/api/admin/events", admin, {
    name: "Evento privado",
    description: "Solo invitados",
    server_address: "mc.example.com:25570",
    pack_code: code,
  });
  assert.equal(created.status, 201, await created.clone().text());
  const event = await created.json();
  assert.match(event.id, /^EVT-[A-Z0-9]{6}$/);
  assert.equal(event.loader, "fabric", "versión y loader salen del pack");
  assert.equal(event.loader_version, "0.16.5");

  // Fuera de la whitelist: no ve nada (ni IP ni pack).
  let mine = await (await call(env, "GET", "/api/events", { token: player })).json();
  assert.equal(mine.admin, false);
  assert.deepEqual(mine.events, []);
  assert.ok(!JSON.stringify(mine).includes("mc.example.com"));

  // Dentro de la whitelist: ve el evento con su pack.
  const dashedPlayer = PLAYER.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const add = await post(env, `/api/admin/events/${event.id}/players`, admin, {
    players: [{ uuid: dashedPlayer, name: "Jugador_1" }],
  });
  assert.equal(add.status, 200);
  mine = await (await call(env, "GET", "/api/events", { token: player })).json();
  assert.equal(mine.events.length, 1);
  assert.equal(mine.events[0].server_address, "mc.example.com:25570");
  assert.equal(mine.events[0].manifest.code, event.id);
  assert.equal(mine.events[0].manifest.mods.length, 1);

  // Evento desactivado: desaparece para los jugadores, no para los admins.
  const edit = await call(env, "PUT", `/api/admin/events/${event.id}`, {
    token: admin,
    body: JSON.stringify({ name: "Evento privado", pack_code: code, active: false }),
  });
  assert.equal(edit.status, 200);
  assert.equal((await (await call(env, "GET", "/api/events", { token: player })).json()).events.length, 0);
  assert.equal((await (await call(env, "GET", "/api/events", { token: admin })).json()).events.length, 1);
  await call(env, "PUT", `/api/admin/events/${event.id}`, {
    token: admin,
    body: JSON.stringify({ name: "Evento privado", pack_code: code, server_address: "mc.example.com" }),
  });

  // No se puede borrar un pack que usa un evento.
  assert.equal((await call(env, "DELETE", `/api/packs/${code}`, { token: admin })).status, 409);

  // Whitelist para el servidor de Minecraft.
  const wlPath = `/api/server/${event.id}/whitelist.json`;
  assert.equal((await call(env, "GET", wlPath)).status, 401);
  assert.equal((await call(env, "GET", wlPath, { token: "mala" })).status, 401);
  // La clave en la URL ya no se acepta (ni siquiera la buena): acabaría en los registros.
  assert.equal((await call(env, "GET", `${wlPath}?key=${SERVER_KEY}`)).status, 400);
  const wl = await (await call(env, "GET", wlPath, { token: SERVER_KEY })).json();
  assert.deepEqual(wl, [{ uuid: dashedPlayer, name: "Jugador_1" }]);

  // Quitarlo de la lista le corta el acceso.
  const del = await call(env, "DELETE", `/api/admin/events/${event.id}/players/${PLAYER}`, { token: admin });
  assert.equal(del.status, 200);
  assert.equal((await (await call(env, "GET", "/api/events", { token: player })).json()).events.length, 0);

  assert.equal((await call(env, "DELETE", `/api/admin/events/${event.id}`, { token: admin })).status, 204);
  assert.equal((await call(env, "DELETE", `/api/packs/${code}`, { token: admin })).status, 204);
});

test("valida los datos del evento", async () => {
  const env = makeEnv();
  const admin = await tokenOf(env);
  const bad = [
    {},
    { name: "x", minecraft_version: "../1" },
    { name: "x", minecraft_version: "1.21.1", loader: "forge" },
    { name: "x", minecraft_version: "1.21.1", loader: "fabric" },
    { name: "x", minecraft_version: "1.21.1", server_address: "http://mc.example.com" },
    { name: "x", minecraft_version: "1.21.1", server_address: "mc.example.com:99999" },
    { name: "x", minecraft_version: "1.21.1", pack_code: "OBS-NOEXIS" },
    { name: "x", minecraft_version: "1.21.1", memory: { min_mb: 4096, max_mb: 1024 } },
  ];
  for (const body of bad) {
    assert.equal((await post(env, "/api/admin/events", admin, body)).status >= 400, true, JSON.stringify(body));
  }
  const ok = await post(env, "/api/admin/events", admin, {
    name: "Vanilla",
    minecraft_version: "1.21.1",
    server_address: "play.example.net",
  });
  assert.equal(ok.status, 201);
  const { id } = await ok.json();
  const badPlayers = await post(env, `/api/admin/events/${id}/players`, admin, {
    players: [{ uuid: "no-es-uuid", name: "x" }],
  });
  assert.equal(badPlayers.status, 400);
});

test("panel web: contraseña, token propio y búsqueda de jugadores", async () => {
  const env = { ...makeEnv(), ADMIN_PASSWORD: "contraseña-larga-de-prueba" };

  const html = await call(env, "GET", "/admin");
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await html.text(), /\/admin\/app\.js/);
  assert.equal((await call(env, "GET", "/admin/app.js")).status, 200);

  const login = (password) =>
    call(env, "POST", "/api/admin/web-login", { body: JSON.stringify({ password }), headers: { "content-type": "application/json" } });
  assert.equal((await login("mala")).status, 401);
  assert.equal((await login("")).status, 401);
  const { token } = await (await login("contraseña-larga-de-prueba")).json();
  assert.match(token, /^web\./);

  // Sirve para administrar, pero no como sesión de jugador.
  assert.equal((await call(env, "GET", "/api/admin/events", { token })).status, 200);
  assert.equal((await call(env, "GET", "/api/events", { token })).status, 401);
  // Un token web manipulado no vale.
  assert.equal((await call(env, "GET", "/api/admin/events", { token: token.slice(0, -2) + "xx" })).status, 401);
  // Un token de jugador (aunque sea admin) no se acepta disfrazado de token web.
  const playerToken = await tokenOf(env, PLAYER);
  assert.equal((await call(env, "GET", "/api/admin/events", { token: `web.${playerToken}` })).status, 401);

  const created = await post(env, "/api/admin/events", token, { name: "Desde la web", minecraft_version: "1.21.1" });
  assert.equal(created.status, 201, await created.clone().text());
  const ev = await created.json();
  assert.equal(ev.created_by, "web");

  // Mojang bloqueado (403) → respaldo playerdb.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.includes("mojang.com")) return new Response("blocked", { status: 403 });
    if (u.endsWith("/Steve")) {
      return Response.json({ data: { player: { raw_id: PLAYER, username: "Steve" } } });
    }
    return new Response("{}", { status: 400 });
  };
  try {
    const found = await call(env, "GET", "/api/admin/resolve?q=Steve", { token });
    assert.deepEqual(await found.json(), { uuid: PLAYER, name: "Steve" });
    assert.equal((await call(env, "GET", "/api/admin/resolve?q=NoExiste", { token })).status, 404);
    assert.equal((await call(env, "GET", "/api/admin/resolve?q=mal%20nombre", { token })).status, 400);
    assert.equal((await call(env, "GET", "/api/admin/resolve?q=Steve", { token: playerToken })).status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }

  const added = await post(env, `/api/admin/events/${ev.id}/players`, token, { players: [{ uuid: PLAYER, name: "Steve" }] });
  assert.equal(added.status, 200);
  const mine = await (await call(env, "GET", "/api/events", { token: playerToken })).json();
  assert.deepEqual(mine.events.map((e) => e.id), [ev.id]);
});

test("panel web: bloquea la fuerza bruta por IP", async () => {
  const env = { ...makeEnv(), ADMIN_PASSWORD: "contraseña-larga-de-prueba" };
  const login = (password, ip = "203.0.113.7") =>
    call(env, "POST", "/api/admin/web-login", { body: JSON.stringify({ password }), headers: { "cf-connecting-ip": ip } });

  for (let i = 1; i < 5; i++) {
    const res = await login(`mala-${i}`);
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, new RegExp(`te quedan ${5 - i}`));
  }
  const locked = await login("mala-5");
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get("retry-after")) > 0);
  // Bloqueada, ni la contraseña buena entra desde esa IP...
  assert.equal((await login("contraseña-larga-de-prueba")).status, 429);
  // ...pero otra IP sí puede.
  assert.equal((await login("contraseña-larga-de-prueba", "198.51.100.2")).status, 200);

  // Un acierto borra los fallos acumulados de esa IP.
  assert.equal((await login("mala", "192.0.2.9")).status, 401);
  assert.equal((await login("contraseña-larga-de-prueba", "192.0.2.9")).status, 200);
  const again = await login("mala", "192.0.2.9");
  assert.match((await again.json()).error, /te quedan 4/);

  // No guarda las IPs en claro.
  const keys = [...(env.BUCKET ?? env.FILES).store.keys()].filter((k) => k.startsWith("web/fails/"));
  assert.ok(keys.length > 0 && keys.every((k) => !k.includes("203.0.113.7")));

  // Con el limitador de Cloudflare configurado, también lo respeta.
  const limited = { ...env, LOGIN_LIMITER: { limit: async () => ({ success: false }) } };
  const res = await call(limited, "POST", "/api/admin/web-login", {
    body: JSON.stringify({ password: "contraseña-larga-de-prueba" }),
    headers: { "cf-connecting-ip": "198.51.100.50" },
  });
  assert.equal(res.status, 429);

  // Cuerpos enormes en el login público: rechazados sin procesarlos.
  const big = await call(env, "POST", "/api/admin/web-login", { body: JSON.stringify({ password: "x".repeat(10000) }) });
  assert.equal(big.status, 413);
});

test("panel web: salir, cerrar todas las sesiones y cambiar la contraseña", async () => {
  const env = { ...makeEnv(), ADMIN_PASSWORD: "contraseña-larga-de-prueba" };
  const loginToken = async (e = env) =>
    (await (await call(e, "POST", "/api/admin/web-login", { body: JSON.stringify({ password: e.ADMIN_PASSWORD }) })).json()).token;
  const canAdmin = async (token, e = env) => (await call(e, "GET", "/api/admin/events", { token })).status;

  // «Salir» invalida ese token en el servidor, no los demás.
  const a = await loginToken();
  const b = await loginToken();
  assert.equal(await canAdmin(a), 200);
  assert.equal((await call(env, "POST", "/api/admin/logout", { token: a })).status, 204);
  assert.equal(await canAdmin(a), 401);
  assert.equal(await canAdmin(b), 200);
  // Salir con un token inválido o sin token no falla.
  assert.equal((await call(env, "POST", "/api/admin/logout", { token: "web.basura" })).status, 204);
  assert.equal((await call(env, "POST", "/api/admin/logout")).status, 204);

  // «Cerrar todas las sesiones» tumba todos los tokens emitidos antes.
  assert.equal((await call(env, "POST", "/api/admin/logout-all")).status, 401);
  assert.equal((await call(env, "POST", "/api/admin/logout-all", { token: await tokenOf(env, PLAYER) })).status, 403);
  assert.equal((await call(env, "POST", "/api/admin/logout-all", { token: b })).status, 204);
  assert.equal(await canAdmin(b), 401);
  await new Promise((r) => setTimeout(r, 1100)); // los tokens van por segundos
  const c = await loginToken();
  assert.equal(await canAdmin(c), 200, "un login nuevo sí vale");

  // Cambiar ADMIN_PASSWORD invalida todas las sesiones abiertas.
  const changed = { ...env, ADMIN_PASSWORD: "otra-contraseña-nueva-123" };
  assert.equal(await canAdmin(c, changed), 401);
  assert.equal(await canAdmin(await loginToken(changed), changed), 200);
  // Y quitarla del todo también.
  assert.equal(await canAdmin(c, { ...env, ADMIN_PASSWORD: undefined }), 401);

  // Un token web antiguo (formato sin huella de contraseña) no vale.
  assert.equal(await canAdmin(c.split(".").filter((_, i) => i !== 1 && i !== 2).join(".")), 401);
});

test("panel web: cabeceras de seguridad", async () => {
  const env = { ...makeEnv(), ADMIN_PASSWORD: "contraseña-larga-de-prueba" };
  for (const path of ["/admin", "/admin/app.js"]) {
    const res = await call(env, "GET", path);
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("strict-transport-security"), /max-age=\d+/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  const api = await call(env, "GET", "/");
  assert.equal(api.headers.get("x-content-type-options"), "nosniff");
  // El panel no usa innerHTML: así puede exigir Trusted Types.
  assert.doesNotMatch(await (await call(env, "GET", "/admin/app.js")).text(), /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
});

test("rangos: cada uno solo puede lo suyo", async () => {
  const env = { ...makeEnv(), ADMIN_PASSWORD: "contraseña-larga-de-prueba" };
  const DEV = "d".repeat(32);
  const STAFF = "5".repeat(32);
  const MEMBER = "1".repeat(32);
  const GUEST = "9".repeat(32);
  const owner = await tokenOf(env); // UUID está en ADMIN_UUIDS: owner fijo
  const setRank = (token, uuid, name, rank) =>
    call(env, "PUT", `/api/admin/members/${uuid}`, { token, body: JSON.stringify({ name, rank }) });

  // Al principio todos son invitados: no pueden administrar nada.
  const guest = await tokenOf(env, GUEST);
  assert.equal((await call(env, "GET", "/api/admin/members", { token: guest })).status, 403);
  const meGuest = await (await call(env, "GET", "/api/events", { token: guest })).json();
  assert.equal(meGuest.rank, "invitado");
  assert.equal(meGuest.admin, false);
  // Sin eventos: el launcher dice «No hay eventos» en vez de «no estás en la whitelist».
  assert.equal(meGuest.any_events, false);

  // El owner reparte rangos.
  assert.equal((await setRank(owner, DEV, "Dev_1", "developer")).status, 200);
  assert.equal((await setRank(owner, STAFF, "Staff_1", "staff")).status, 200);
  assert.equal((await setRank(owner, "a".repeat(32), "x", "rey")).status, 400, "rango inexistente");
  // Nadie cambia a un owner fijo, ni siquiera otro owner.
  assert.equal((await setRank(owner, UUID, "Yo", "miembro")).status, 403);

  const dev = await tokenOf(env, DEV);
  const staff = await tokenOf(env, STAFF);

  // Lo que ve cada uno al abrir el launcher.
  const meStaff = await (await call(env, "GET", "/api/events", { token: staff })).json();
  assert.equal(meStaff.rank, "staff");
  assert.equal(meStaff.admin, true);
  assert.deepEqual(meStaff.permissions, {
    manage_whitelist: true,
    manage_ranks: true,
    manage_events: false,
    assignable: ["invitado", "miembro"],
  });
  const meDev = await (await call(env, "GET", "/api/events", { token: dev })).json();
  assert.equal(meDev.permissions.manage_events, true);
  assert.deepEqual(meDev.permissions.assignable, ["invitado", "miembro", "staff"]);

  // Developer crea eventos; Staff no.
  const created = await post(env, "/api/admin/events", dev, { name: "Del dev", minecraft_version: "1.21.1", active: false });
  assert.equal(created.status, 201);
  const ev = await created.json();
  assert.equal((await post(env, "/api/admin/events", staff, { name: "x", minecraft_version: "1.21.1" })).status, 403);
  assert.equal((await call(env, "DELETE", `/api/admin/events/${ev.id}`, { token: staff })).status, 403);

  // El equipo ve todos los eventos (aunque estén cerrados y no esté en la whitelist).
  const staffEvents = await (await call(env, "GET", "/api/events", { token: staff })).json();
  assert.deepEqual(staffEvents.events.map((e) => e.id), [ev.id]);
  const guestView = await (await call(env, "GET", "/api/events", { token: guest })).json();
  assert.equal(guestView.events.length, 0);
  assert.equal(guestView.any_events, false, "el único evento está cerrado: no cuenta");
  // Con un evento abierto en el que no está, sí es «no estás en la whitelist».
  const open = await (await post(env, "/api/admin/events", dev, { name: "Abierto", minecraft_version: "1.21.1" })).json();
  const guestView2 = await (await call(env, "GET", "/api/events", { token: guest })).json();
  assert.deepEqual([guestView2.events.length, guestView2.any_events], [0, true]);
  assert.equal((await call(env, "DELETE", `/api/admin/events/${open.id}`, { token: dev })).status, 204);

  // Staff añade a la whitelist y da Miembro, pero no Staff ni superior.
  const players = `/api/admin/events/${ev.id}/players`;
  const addedMember = await post(env, players, staff, { players: [{ uuid: MEMBER, name: "Miembro_1", rank: "miembro" }] });
  assert.equal(addedMember.status, 200);
  assert.deepEqual((await addedMember.json()).players.map((p) => [p.name, p.rank]), [["Miembro_1", "miembro"]]);
  const tooHigh = await post(env, players, staff, { players: [{ uuid: GUEST, name: "Invitado_1", rank: "staff" }] });
  assert.equal(tooHigh.status, 403);
  assert.match((await tooHigh.json()).error, /Invitado_1/);
  // Si uno falla, no se añade ninguno.
  const mixed = await post(env, players, staff, {
    players: [
      { uuid: GUEST, name: "Invitado_1" },
      { uuid: DEV, name: "Dev_1", rank: "miembro" },
    ],
  });
  assert.equal(mixed.status, 403);
  const afterMixed = await (await call(env, "GET", "/api/admin/events", { token: staff })).json();
  assert.equal(afterMixed.events[0].players.length, 1);
  // Sin `rank` se añade sin tocar su rango (aunque sea mayor que el suyo).
  const plain = await post(env, players, staff, { players: [{ uuid: DEV, name: "Dev_1" }] });
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).players.find((p) => p.uuid === DEV).rank, "developer");

  // Staff no puede quitar de la whitelist a un Developer; sí a un Miembro.
  assert.equal((await call(env, "DELETE", `${players}/${DEV}`, { token: staff })).status, 403);
  assert.equal((await call(env, "DELETE", `${players}/${MEMBER}`, { token: staff })).status, 200);

  // Developer da Staff, pero no Developer ni Owner, y no toca a otro Developer.
  assert.equal((await setRank(dev, MEMBER, "Miembro_1", "staff")).status, 200);
  assert.equal((await setRank(dev, GUEST, "Invitado_1", "developer")).status, 403);
  assert.equal((await setRank(dev, GUEST, "Invitado_1", "owner")).status, 403);
  assert.equal((await setRank(dev, DEV, "Dev_1", "staff")).status, 403, "ni a sí mismo");
  // Staff no puede bajar a otro Staff.
  assert.equal((await setRank(staff, MEMBER, "Miembro_1", "miembro")).status, 403);
  assert.equal((await call(env, "DELETE", `/api/admin/members/${MEMBER}`, { token: staff })).status, 403);
  assert.equal((await call(env, "DELETE", `/api/admin/members/${MEMBER}`, { token: dev })).status, 204);

  // La lista de rangos: owner fijo primero, luego de mayor a menor.
  const list = await (await call(env, "GET", "/api/admin/members", { token: staff })).json();
  assert.deepEqual(list.me, { id: STAFF, rank: "staff" });
  assert.deepEqual(list.assignable, ["invitado", "miembro"]);
  assert.deepEqual(list.members.map((m) => [m.uuid, m.rank, !!m.fixed]), [
    [UUID, "owner", true],
    [DEV, "developer", false],
    [STAFF, "staff", false],
  ]);

  // El panel web (contraseña) es owner: puede dar Owner, y ese owner nuevo puede dar Developer.
  const web = (await (await call(env, "POST", "/api/admin/web-login", { body: JSON.stringify({ password: env.ADMIN_PASSWORD }) })).json()).token;
  assert.equal((await setRank(web, GUEST, "Invitado_1", "owner")).status, 200);
  const newOwner = await tokenOf(env, GUEST);
  assert.equal((await setRank(newOwner, MEMBER, "Miembro_1", "developer")).status, 200);
  // Solo un owner cierra todas las sesiones del panel.
  assert.equal((await call(env, "POST", "/api/admin/logout-all", { token: dev })).status, 403);

  // El servidor de Minecraft deja entrar al equipo aunque no esté en la whitelist del evento.
  const wl = await (await call(env, "GET", `/api/server/${ev.id}/whitelist.json`, { token: SERVER_KEY })).json();
  const names = wl.map((p) => p.name).sort();
  assert.deepEqual(names, ["Dev_1", "Invitado_1", "Miembro_1", "Staff_1"]);

  // Desde el panel web se puede cambiar a cualquiera, también a ADMIN_UUIDS.
  const rankOf = async (uuid) => (await (await call(env, "GET", "/api/events", { token: await tokenOf(env, uuid) })).json()).rank;
  // Aunque todavía no se conozca su nombre de Minecraft.
  assert.equal((await setRank(web, UUID, "", "developer")).status, 200);
  assert.equal(await rankOf(UUID), "developer");
  // Para el resto de cuentas el nombre sigue siendo obligatorio.
  assert.equal((await setRank(web, "e".repeat(32), "", "miembro")).status, 400);
  assert.equal((await setRank(web, UUID, "Fundador", "staff")).status, 200);
  assert.equal(await rankOf(UUID), "staff");
  const fixedRow = (await (await call(env, "GET", "/api/admin/members", { token: web })).json()).members.find((m) => m.uuid === UUID);
  assert.deepEqual([fixedRow.rank, fixedRow.fixed, fixedRow.name], ["staff", true, "Fundador"]);
  // Al quitarle el rango se queda en Invitado (no vuelve a Owner por estar en ADMIN_UUIDS).
  assert.equal((await call(env, "DELETE", `/api/admin/members/${UUID}`, { token: web })).status, 204);
  assert.equal(await rankOf(UUID), "invitado");
  assert.equal((await call(env, "GET", "/api/admin/members", { token: await tokenOf(env, UUID) })).status, 403);
  // Un owner del launcher sigue sin poder tocar ADMIN_UUIDS; el panel web lo devuelve a Owner.
  assert.equal((await setRank(newOwner, UUID, "Fundador", "owner")).status, 403);
  assert.equal((await setRank(web, UUID, "Fundador", "owner")).status, 200);
  assert.equal(await rankOf(UUID), "owner");
  // El panel web también puede bajar a cualquier Owner.
  assert.equal((await setRank(web, GUEST, "Invitado_1", "miembro")).status, 200);
  assert.equal(await rankOf(GUEST), "miembro");
});

test("panel web: sin ADMIN_PASSWORD no se puede entrar", async () => {
  const env = makeEnv();
  const res = await call(env, "POST", "/api/admin/web-login", { body: JSON.stringify({ password: "" }) });
  assert.equal(res.status, 503);
});

test("panel web: crear un pack con mods y leerlo para editarlo", async () => {
  const env = { ...makeEnv(), ADMIN_PASSWORD: "contraseña-larga-de-prueba" };
  const login = await call(env, "POST", "/api/admin/web-login", { body: JSON.stringify({ password: "contraseña-larga-de-prueba" }) });
  const { token } = await login.json();

  // Un .jar propio subido desde la web y otro de Modrinth.
  const jar = new TextEncoder().encode("jar privado");
  assert.equal((await upload(env, token, jar)).status, 201);
  const m = manifest(`${ORIGIN}/files/${sha1(jar)}`, sha1(jar), jar.byteLength);
  m.mods.push({ file_name: "sodium.jar", url: "https://cdn.modrinth.com/data/AANobbMI/x/sodium.jar", sha1: "b".repeat(40), size: 9, title: "Sodium", project_id: "AANobbMI" });
  const created = await post(env, "/api/packs", token, m);
  assert.equal(created.status, 201, await created.clone().text());
  const { code } = await created.json();

  const got = await call(env, "GET", `/api/admin/packs/${code}`, { token });
  assert.equal(got.status, 200);
  const pack = await got.json();
  assert.equal(pack.mods.length, 2);
  assert.equal(pack.mods[1].project_id, "AANobbMI", "guarda los datos extra para mostrarlos");
  assert.equal((await call(env, "GET", `/api/admin/packs/${code}`, { token: await tokenOf(env, PLAYER) })).status, 403);
  assert.equal((await call(env, "GET", "/api/admin/packs/OBS-ZZZZZZ", { token })).status, 404);

  const ev = await (await post(env, "/api/admin/events", token, { name: "Con mods", pack_code: code })).json();
  assert.equal(ev.loader, "fabric");
  // Mientras el evento lo usa no se puede borrar; después sí.
  assert.equal((await call(env, "DELETE", `/api/packs/${code}`, { token })).status, 409);
  await call(env, "PUT", `/api/admin/events/${ev.id}`, { token, body: JSON.stringify({ name: "Con mods", minecraft_version: "1.21.1" }) });
  assert.equal((await call(env, "DELETE", `/api/packs/${code}`, { token })).status, 204);
});
