# Obsidia Eventos

Versión de [Obsidia](https://github.com/DevAldx/Obsidia) para eventos: un
**cliente privado** de Minecraft: Java Edition. Solo entran las cuentas que el
organizador añade a la **whitelist** de un evento. Rust + Tauri 2 + Svelte 5.

Comparado con Obsidia normal:

| | Obsidia | Obsidia Eventos |
|---|---|---|
| Acceso | cualquiera | solo cuentas en la whitelist de algún evento |
| Cuentas | Microsoft o local | solo Microsoft (la whitelist va por UUID) |
| Instancias | las creas tú | una por evento, la define el organizador |
| Mods | navegador de Modrinth, importar, activar | solo los del pack del evento; los demás se borran al jugar |
| Comunidad | catálogo, compartir, publicar | no existe |
| Jugar | abre el menú del juego | entra directamente al servidor del evento |

Usa sus propias carpetas (`~/.local/share/obsidia-eventos`,
`%APPDATA%\obsidia\obsidia-eventos`), su propia entrada en el llavero del
sistema y su propio canal de actualizaciones, así que puede convivir con
Obsidia normal en el mismo PC.

## Cómo funciona el acceso

```
Launcher ──(certificado de jugador firmado por Mojang)──▶ Servidor de eventos (Worker)
         ◀── eventos donde tu UUID está en la whitelist ──
         ──▶ descarga el pack, borra mods ajenos, lanza con --quickPlayMultiplayer / --server
```

1. El jugador inicia sesión con Microsoft.
2. El launcher se identifica ante el servidor de eventos con el certificado de
   jugador de Mojang (el mismo par de claves que Minecraft usa para firmar el
   chat). El servidor comprueba la firma de Mojang: nadie puede hacerse pasar
   por otro UUID y el token de Minecraft nunca sale hacia el servidor.
3. El servidor devuelve **solo** los eventos cuya whitelist contiene ese UUID.
   Fuera de la lista no se recibe nada: ni la IP del servidor ni el pack.
4. Al pulsar Jugar, el launcher vuelve a pedir el evento al servidor (el
   frontend no puede inventarse uno), sincroniza la instancia `EVT-XXXXXX`
   (versión, loader, memoria, mods, configs) y abre el juego conectado al
   servidor.

La comprobación vive en el servidor: modificar el launcher no sirve para
colarse en un evento.

### Importante: protege también el servidor de Minecraft

El launcher no puede impedir que alguien que **ya conoce la IP** entre con otro
launcher. El servidor de Minecraft debe tener su propia whitelist
(`white-list=true` y `enforce-whitelist=true` en `server.properties`). El
servidor de eventos la genera en el formato de Minecraft:

```bash
curl -fsS -H "Authorization: Bearer $SERVER_KEY" \
  https://obsidia-eventos.<cuenta>.workers.dev/api/server/EVT-XXXXXX/whitelist.json \
  -o whitelist.json
# y en la consola del servidor: whitelist reload
```

Ponlo en un cron cada pocos minutos y la whitelist del servidor seguirá a la
del panel de administración.

## Organizar un evento

1. **Despliega el servidor de eventos** (una vez): ver
   [`server/README.md`](server/README.md). Pon tu UUID en `ADMIN_UUIDS`.
2. **Prepara el pack** (si el evento lleva mods): en Obsidia normal, crea la
   instancia con sus mods, pon la URL del servidor de eventos en **Ajustes →
   Compartir** y usa **Compartir → Subir al servidor**. Te dará un código
   `OBS-XXXXXX`. Solo los admins pueden subir.
3. **Crea el evento** en Obsidia Eventos → pestaña **Admin**: nombre,
   descripción, dirección del servidor de Minecraft y código del pack (o versión
   y loader si es vanilla).
4. **Añade a los participantes**: escribe nombres de Minecraft o UUIDs (varios
   a la vez, separados por comas o saltos de línea). El launcher los busca en
   Mojang y los añade.
5. Desmarca **Abierto** para ocultar el evento a los jugadores sin borrarlo.

Quien no esté en ninguna whitelist ve «Acceso restringido» con su nombre y su
UUID listos para copiar y mandárselos al organizador.

## Desarrollo

```bash
npm install
cargo test -p obsidia-core      # núcleo
(cd server && npm test)         # servidor de eventos (KV y R2)
npm run check                   # svelte-check + TypeScript
npm run tauri dev
./scripts/build-appimage.sh     # AppImage firmado
```

```
crates/obsidia-core/  Lógica sin Tauri (events.rs: cliente del servidor de eventos)
server/               Servidor de eventos: whitelist, eventos y packs (Cloudflare Worker)
src-tauri/            Comandos IPC
src/                  Frontend (pages/Home = eventos, pages/Admin = organizadores)
```

## Publicar

Este proyecto **no** publica en las releases de Obsidia: su updater lee
`https://github.com/DevAldx/Obsidia-Eventos/releases/latest/download/latest.json`.
Crea ese repositorio, añade el secreto `TAURI_SIGNING_PRIVATE_KEY` y empuja una
etiqueta `vX.Y.Z` (ver `VERSIONADO.md`). Si publicaras esta app en las releases
de Obsidia, los launchers normales se «actualizarían» a la versión de eventos.

## Aviso legal

Obsidia Eventos es un proyecto independiente. **No está afiliado, asociado,
autorizado, respaldado ni patrocinado por Mojang Studios, Microsoft Corporation
ni sus filiales.** Minecraft es una marca registrada de Mojang Studios. No
incluye ni distribuye Minecraft.
