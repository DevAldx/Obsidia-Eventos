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
  assert.equal((await call(env, "GET", `${wlPath}?key=mala`)).status, 401);
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
