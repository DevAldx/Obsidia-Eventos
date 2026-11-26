# Servidor de eventos

Un Cloudflare Worker que guarda los eventos, su **whitelist** y los packs
(mods privados, configs e imágenes). Es lo que decide quién entra: el launcher
solo enseña lo que este servidor le devuelve.

## Desplegarlo (Workers KV, sin tarjeta)

Necesitas una cuenta de Cloudflare (gratis) y Node.js.

```bash
cd server
npx wrangler login
npx wrangler kv namespace create FILES      # copia el "id" que imprime
```

Pon ese id en `wrangler.toml` (`id = "PEGA_AQUI_EL_ID"`). Usa un namespace
**nuevo**, no el de `obsidia-share`. Pon tu UUID (sin guiones) en
`ADMIN_UUIDS`; con varios organizadores, sepáralos con comas. Luego:

```bash
npx wrangler secret put SECRET        # pega: openssl rand -base64 48
npx wrangler secret put SERVER_KEY    # pega: openssl rand -hex 24
npx wrangler deploy
```

`wrangler deploy` imprime la URL. Si tu subdominio de workers.dev es
`obsidia-share`, será `https://obsidia-eventos.obsidia-share.workers.dev`, que
es la que trae el launcher por defecto. Si sale otra, cámbiala en
`DEFAULT_SHARE_URL` (`crates/obsidia-core/src/config/mod.rs` y `src/lib/api.ts`)
antes de compilar, o pídele a cada jugador que la ponga en **Ajustes →
Servidor de eventos**.

## Panel web

Además del panel Admin del launcher, hay uno en el navegador:
`https://obsidia-eventos.<cuenta>.workers.dev/admin`. Se entra con una
contraseña que se guarda como secreto:

```bash
npx wrangler secret put ADMIN_PASSWORD    # 12 caracteres o más
```

Desde ahí se crean y editan eventos y se gestiona la whitelist (por nombre o
UUID; el Worker busca la cuenta en Mojang y, si Cloudflare está bloqueado,
en playerdb.co). La sesión web dura 12 horas y solo vale para administrar.

### Rangos

Cada cuenta tiene **un rango para todos los eventos**. Se da desde el panel web
(sección **Rangos**, o el selector al añadir a la whitelist) o desde la pestaña
**Admin** del launcher.

| Rango | Qué puede hacer |
|---|---|
| **Owner** | Todo, incluido dar cualquier rango (también Owner). |
| **Developer** | Crear, editar y borrar eventos y mods; whitelist; dar rangos hasta Staff. |
| **Staff** | Añadir y quitar de la whitelist; dar Miembro o Invitado. Entra a todos los eventos. |
| **Miembro** | Juega los eventos en cuya whitelist está. |
| **Invitado** | Igual que Miembro. Es el rango por defecto. |

- Nadie puede cambiar ni quitar de una whitelist a alguien con su rango o superior (salvo un Owner).
- Las cuentas de `ADMIN_UUIDS` son **Owner fijos**: su rango no se cambia desde el panel.
- Quien entra al panel web con la contraseña actúa como Owner.
- El `whitelist.json` del servidor de Minecraft incluye la whitelist del evento
  y al equipo (Staff, Developer y Owner), porque el equipo entra a todos los eventos.
- Los rangos se guardan en `members/index.json` del almacenamiento.

### Seguridad del panel

- **Fuerza bruta:** 5 contraseñas incorrectas en 15 minutos bloquean esa IP
  otros 15 minutos (responde `429`, incluso con la contraseña buena). Las IPs
  no se guardan en claro, solo un HMAC. Usa una contraseña larga y aleatoria:
  `openssl rand -base64 24`.
- **Salir** cierra la sesión también en el servidor; el token deja de valer
  aunque alguien lo haya copiado.
- **Cerrar todas las sesiones** (botón del panel o `POST /api/admin/logout-all`)
  invalida todas las sesiones web abiertas, por ejemplo si se pierde un portátil.
- **Cambiar `ADMIN_PASSWORD`** (`npx wrangler secret put ADMIN_PASSWORD`)
  invalida todas las sesiones web al momento.
- Con Workers KV, la revocación puede tardar hasta un minuto en llegar a todas
  las regiones de Cloudflare.
- Cabeceras: CSP estricta (solo scripts propios y Trusted Types), sin iframes,
  HSTS, `nosniff` y sin caché.
- **Opcional:** el limitador de Cloudflare (`LOGIN_LIMITER` en `wrangler.toml`)
  frena los intentos antes de tocar KV, así un ataque desde muchas IPs no gasta
  las escrituras gratuitas de KV.

## Rutas

| Ruta | Quién | Para qué |
|---|---|---|
| `POST /api/challenge`, `POST /api/login` | el launcher | iniciar sesión con el certificado de Mojang |
| `GET /api/events` | con sesión | los eventos cuya whitelist incluye tu UUID (con IP y pack) |
| `GET /api/admin/events` | admin | todos los eventos con su whitelist |
| `POST /api/admin/events` | admin | crear evento |
| `PUT /api/admin/events/<EVT-…>` | admin | editar evento |
| `DELETE /api/admin/events/<EVT-…>` | admin | borrar evento |
| `POST /api/admin/events/<EVT-…>/players` | admin | añadir `{ players: [{ uuid, name }] }` |
| `DELETE /api/admin/events/<EVT-…>/players/<uuid>` | admin | quitar de la whitelist |
| `PUT /api/files/<sha1>`, `POST /api/packs`, `DELETE /api/packs/<código>` | admin | subir y borrar packs (desde Obsidia normal) |
| `POST /api/files/<sha1>/multipart` | Developer+ | `{ size }` empieza a subir un archivo grande (`single: true` si cabe de una vez) |
| `PUT /api/files/<sha1>/multipart/<n>` | Developer+ | la parte `n` (`part_size` bytes; la última, el resto) |
| `POST /api/files/<sha1>/multipart/complete` | Developer+ | `{ parts: [{ part_number, etag }] }` |
| `DELETE /api/files/<sha1>/multipart` | Developer+ | cancela la subida |
| `GET /files/<sha1>` | cualquiera con el hash | un archivo de un pack |
| `GET /admin` | navegador | panel web de administración |
| `POST /api/admin/web-login` | navegador | `{ password }` → sesión web de admin |
| `POST /api/admin/logout` | navegador | cierra la sesión web actual en el servidor |
| `POST /api/admin/logout-all` | Owner | cierra todas las sesiones web |
| `GET /api/admin/members` | Staff+ | cuentas con rango y rangos que puedes dar |
| `PUT /api/admin/members/<uuid>` | Staff+ | `{ name, rank }` da un rango |
| `DELETE /api/admin/members/<uuid>` | Staff+ | quita el rango (vuelve a Invitado) |
| `GET /api/admin/resolve?q=<nombre o uuid>` | admin | busca la cuenta de Minecraft |
| `GET /api/server/<EVT-…>/whitelist.json` | servidor de Minecraft (`SERVER_KEY`) | la whitelist en el formato de Minecraft |

- **Identidad:** el launcher firma un desafío con la clave del certificado de
  jugador, y Mojang firma esa clave para el UUID. El Worker comprueba las dos
  firmas sin hablar con Mojang. No se puede suplantar un UUID.
- **Whitelist:** por UUID. El nombre solo se muestra; si un jugador cambia de
  nombre sigue teniendo acceso.
- **Packs:** ya no hay manifiestos públicos (`/OBS-XXXXXX.json` no existe en
  este servidor). El pack solo llega dentro de la respuesta de `/api/events`,
  a quien está en la whitelist. Los archivos se sirven por su SHA-1: nadie los
  encuentra sin conocer el hash, pero quien lo conozca puede descargarlos.
- **Eventos cerrados** (`active: false`): los jugadores no los ven; los admins sí.
- Todo vive en un índice (`events/index.json`). Dos admins guardando
  exactamente a la vez podrían pisarse; vuelve a cargar si ves algo raro.

## Archivos grandes

Antes de subir un mod, búscalo en Modrinth desde el panel (Cobblemon está
ahí): esos se descargan de Modrinth y no ocupan nada aquí.

Lo que subes tú se guarda así:

- **Sin tarjeta (KV):** hasta 25 MB, de una vez, y el servidor comprueba su
  SHA-1. Lo que pase se sube en partes de 20 MB y cada parte queda como un
  trozo de KV; al descargar se mandan uno detrás de otro. **El KV gratis tiene
  1 GB en total**, así que caben dos o tres mods de 300 MB. Los trozos de una
  subida que no se termina se borran al empezar la siguiente (pasado un día).
- **Con R2 (más espacio):** activa R2 en el panel de Cloudflare (pide tarjeta;
  10 GB gratis), `npx wrangler r2 bucket create obsidia-eventos-files`,
  descomenta el bloque `BLOBS` de `wrangler.toml` y despliega. Solo los
  archivos nuevos van a R2; lo demás y los archivos viejos siguen en KV. Hasta
  90 MB se suben de una vez (R2 comprueba el SHA-1); lo que pase, en partes de
  50 MB.

El SHA-1 de lo que se sube por partes no lo puede calcular el Worker (no le da
el tiempo de CPU): lo comprueba el launcher al descargar. El máximo por
archivo es `MAX_FILE_MB`.

## Proteger el servidor de Minecraft

La whitelist del launcher no sirve de nada si el servidor de Minecraft acepta a
cualquiera que tenga la IP. En `server.properties`:

```
white-list=true
enforce-whitelist=true
online-mode=true
```

Y sincroniza su `whitelist.json` desde aquí (por ejemplo, cada 5 minutos con cron):

```bash
curl -fsS -H "Authorization: Bearer $SERVER_KEY" \
  "https://obsidia-eventos.<cuenta>.workers.dev/api/server/EVT-XXXXXX/whitelist.json" \
  -o /ruta/al/servidor/whitelist.json && rcon-cli whitelist reload
```

La clave va **solo** en la cabecera `Authorization`. Si se pasa en la URL
(`?key=…`) el servidor responde `400`: en la URL acabaría en registros e
historiales.

## Pruebas

```bash
npm test        # con R2, con KV y con KV + R2 (BLOBS), sin red
```
