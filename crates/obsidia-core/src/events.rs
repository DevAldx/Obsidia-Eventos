//! Cliente del servidor de eventos (`server/` en este repo).
//!
//! El acceso se decide en el servidor: el launcher inicia sesión con el
//! certificado de jugador de Mojang (igual que para subir packs) y pide sus
//! eventos. Si la cuenta no está en la whitelist de ninguno, el servidor no
//! devuelve nada: ni la dirección del servidor de Minecraft ni el pack.
//!
//! Cada evento se juega en su propia instancia (`instances/EVT-XXXXXX`), que el
//! launcher mantiene idéntica a lo que manda el organizador: versión, loader,
//! memoria y mods. Los mods que no están en el pack se borran antes de jugar.

use std::{collections::HashSet, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    background,
    downloads::Downloader,
    error::CoreError,
    instances::{InstanceId, InstanceStore, Loader, Memory, NewInstance},
    minecraft::Reporter,
    share::{self, InstanceManifest},
    share_upload::{self, check, net, Identity},
    ObsidiaPaths, Result,
};

/// Memoria por defecto si el evento no fija ninguna.
const DEFAULT_MEMORY: Memory = Memory {
    min_mb: 2048,
    max_mb: 4096,
};
/// Archivo donde se recuerda qué imagen del evento hay descargada.
const IMAGE_MARKER: &str = ".event-image-url";

/// Evento tal como lo ve un jugador que está en su whitelist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub minecraft_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub server_address: Option<String>,
    #[serde(default)]
    pub memory: Option<Memory>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default = "yes")]
    pub active: bool,
    #[serde(default)]
    pub manifest: Option<InstanceManifest>,
    #[serde(default)]
    pub updated: Option<String>,
}

fn yes() -> bool {
    true
}

/// Rangos globales, de menor a mayor (los decide el servidor de eventos).
pub const RANKS: [&str; 5] = ["invitado", "miembro", "staff", "developer", "owner"];

/// Qué puede hacer la cuenta en el panel de administración.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Permissions {
    #[serde(default)]
    pub manage_whitelist: bool,
    #[serde(default)]
    pub manage_ranks: bool,
    #[serde(default)]
    pub manage_events: bool,
    /// Rangos que puede dar.
    #[serde(default)]
    pub assignable: Vec<String>,
}

impl Permissions {
    fn owner() -> Self {
        Self {
            manage_whitelist: true,
            manage_ranks: true,
            manage_events: true,
            assignable: RANKS.iter().map(|r| r.to_string()).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyEvents {
    pub uuid: String,
    /// Staff o superior: ve la pestaña Admin y entra a todos los eventos.
    pub admin: bool,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default)]
    pub permissions: Permissions,
    /// ¿Hay algún evento abierto en el servidor? (None = servidor antiguo, no lo dice)
    #[serde(default)]
    pub any_events: Option<bool>,
    pub events: Vec<EventInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    /// UUID sin guiones.
    pub uuid: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added: Option<String>,
    /// Al leer: su rango global. Al añadir: el rango que se le asigna (None = no cambiarlo).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rank: Option<String>,
}

/// Una cuenta con rango (vista de administración).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub uuid: String,
    #[serde(default)]
    pub name: Option<String>,
    pub rank: String,
    /// Owner fijo (ADMIN_UUIDS del servidor): su rango no se puede cambiar.
    #[serde(default)]
    pub fixed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MembersView {
    pub members: Vec<Member>,
    #[serde(default)]
    pub assignable: Vec<String>,
}

/// Evento completo (vista de administración, con la whitelist).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminEvent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub server_address: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub pack_code: Option<String>,
    pub minecraft_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub memory: Option<Memory>,
    #[serde(default = "yes")]
    pub active: bool,
    #[serde(default)]
    pub players: Vec<Player>,
    #[serde(default)]
    pub updated: Option<String>,
}

/// Lo que envía el panel de administración al crear o editar un evento.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub server_address: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub pack_code: Option<String>,
    #[serde(default)]
    pub minecraft_version: Option<String>,
    #[serde(default)]
    pub loader: Option<Loader>,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub memory: Option<Memory>,
    #[serde(default = "yes")]
    pub active: bool,
}

#[derive(Deserialize)]
struct AdminList {
    events: Vec<AdminEvent>,
}

#[derive(Deserialize)]
struct PlayersResponse {
    players: Vec<Player>,
}

/// Sesión iniciada en el servidor de eventos (el token dura una hora).
#[derive(Debug, Clone)]
pub struct Session {
    pub base: String,
    pub token: String,
}

pub async fn login(base_url: &str, identity: &Identity) -> Result<Session> {
    let base = share_upload::normalize_base(base_url)?;
    let http = share_upload::http_client()?;
    let token = share_upload::login(&http, &base, identity).await?;
    Ok(Session { base, token })
}

/// ¿El error es de sesión caducada o no válida? (para reintentar con login).
pub fn is_session_error(e: &CoreError) -> bool {
    let msg = e.to_string();
    msg.contains("sesión no válida") || msg.contains("sesión ha caducado") || msg.contains("falta iniciar sesión")
}

const WHAT: &str = "servidor de eventos";

async fn get_json<T: for<'de> Deserialize<'de>>(s: &Session, path: &str) -> Result<T> {
    let http = share_upload::http_client()?;
    check(
        http.get(format!("{}{path}", s.base))
            .bearer_auth(&s.token)
            .send()
            .await
            .map_err(net(WHAT))?,
        WHAT,
    )
    .await?
    .json()
    .await
    .map_err(net(WHAT))
}

async fn send_json<T: for<'de> Deserialize<'de>>(
    s: &Session,
    method: reqwest::Method,
    path: &str,
    body: &impl Serialize,
) -> Result<T> {
    let http = share_upload::http_client()?;
    check(
        http.request(method, format!("{}{path}", s.base))
            .bearer_auth(&s.token)
            .json(body)
            .send()
            .await
            .map_err(net(WHAT))?,
        WHAT,
    )
    .await?
    .json()
    .await
    .map_err(net(WHAT))
}

fn event_id(id: &str) -> Result<InstanceId> {
    let id = InstanceId::parse(id)?;
    if !id.is_event() {
        return Err(CoreError::invalid("identificador de evento inválido"));
    }
    Ok(id)
}

/// Eventos a los que la cuenta tiene acceso (vacío = no está en ninguna whitelist).
pub async fn my_events(s: &Session) -> Result<MyEvents> {
    let mut me: MyEvents = get_json(s, "/api/events").await?;
    // Nada que no tenga un ID de evento válido llega a convertirse en carpeta.
    me.events.retain(|e| event_id(&e.id).is_ok());
    // Servidor anterior a los rangos: sus admins lo podían todo.
    if me.rank.is_none() && me.admin {
        me.rank = Some("owner".into());
        me.permissions = Permissions::owner();
    }
    Ok(me)
}

pub async fn admin_members(s: &Session) -> Result<MembersView> {
    get_json(s, "/api/admin/members").await
}

/// Da un rango global a una cuenta. `invitado` le quita el rango que tuviera.
pub async fn admin_member_set(s: &Session, uuid: &str, name: &str, rank: &str) -> Result<()> {
    let uuid = normalize_uuid(uuid).ok_or_else(|| CoreError::invalid("UUID inválido"))?;
    if !valid_name(name) {
        return Err(CoreError::invalid(format!("nombre inválido: {name}")));
    }
    if !RANKS.contains(&rank) {
        return Err(CoreError::invalid(format!("rango inválido: {rank}")));
    }
    let http = share_upload::http_client()?;
    let url = format!("{}/api/admin/members/{uuid}", s.base);
    let req = if rank == "invitado" {
        http.delete(url)
    } else {
        http.put(url).json(&serde_json::json!({ "name": name, "rank": rank }))
    };
    check(req.bearer_auth(&s.token).send().await.map_err(net(WHAT))?, WHAT).await?;
    Ok(())
}

pub async fn admin_list(s: &Session) -> Result<Vec<AdminEvent>> {
    Ok(get_json::<AdminList>(s, "/api/admin/events").await?.events)
}

pub async fn admin_save(s: &Session, id: Option<&str>, input: &EventInput) -> Result<AdminEvent> {
    match id {
        Some(id) => {
            let id = event_id(id)?;
            send_json(s, reqwest::Method::PUT, &format!("/api/admin/events/{id}"), input).await
        }
        None => send_json(s, reqwest::Method::POST, "/api/admin/events", input).await,
    }
}

pub async fn admin_delete(s: &Session, id: &str) -> Result<()> {
    let id = event_id(id)?;
    let http = share_upload::http_client()?;
    check(
        http.delete(format!("{}/api/admin/events/{id}", s.base))
            .bearer_auth(&s.token)
            .send()
            .await
            .map_err(net(WHAT))?,
        WHAT,
    )
    .await?;
    Ok(())
}

pub async fn admin_add_players(s: &Session, id: &str, players: &[Player]) -> Result<Vec<Player>> {
    let id = event_id(id)?;
    let body = serde_json::json!({ "players": players });
    let r: PlayersResponse =
        send_json(s, reqwest::Method::POST, &format!("/api/admin/events/{id}/players"), &body).await?;
    Ok(r.players)
}

pub async fn admin_remove_player(s: &Session, id: &str, uuid: &str) -> Result<Vec<Player>> {
    let id = event_id(id)?;
    let uuid = normalize_uuid(uuid).ok_or_else(|| CoreError::invalid("UUID inválido"))?;
    let http = share_upload::http_client()?;
    let r: PlayersResponse = check(
        http.delete(format!("{}/api/admin/events/{id}/players/{uuid}", s.base))
            .bearer_auth(&s.token)
            .send()
            .await
            .map_err(net(WHAT))?,
        WHAT,
    )
    .await?
    .json()
    .await
    .map_err(net(WHAT))?;
    Ok(r.players)
}

// ───────────────────────────── Jugadores ─────────────────────────────

/// UUID en minúsculas y sin guiones, si `s` lo es.
pub fn normalize_uuid(s: &str) -> Option<String> {
    let u: String = s.trim().chars().filter(|c| *c != '-').collect::<String>().to_ascii_lowercase();
    (u.len() == 32 && u.chars().all(|c| c.is_ascii_hexdigit())).then_some(u)
}

fn valid_name(s: &str) -> bool {
    (1..=16).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[derive(Deserialize)]
struct MojangProfile {
    id: String,
    name: String,
}

/// Busca en Mojang una cuenta por nombre o por UUID (para añadirla a la whitelist).
pub async fn resolve_player(query: &str) -> Result<Player> {
    let query = query.trim();
    let url = if let Some(uuid) = normalize_uuid(query) {
        format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}")
    } else if valid_name(query) {
        format!("https://api.mojang.com/users/profiles/minecraft/{query}")
    } else {
        return Err(CoreError::invalid(format!(
            "«{query}» no es un nombre de Minecraft ni un UUID"
        )));
    };
    let http = share_upload::http_client()?;
    let resp = http.get(url).send().await.map_err(net("Mojang"))?;
    if matches!(resp.status().as_u16(), 204 | 404) {
        return Err(CoreError::invalid(format!(
            "no existe ninguna cuenta de Minecraft «{query}»"
        )));
    }
    let profile: MojangProfile = check(resp, "Mojang").await?.json().await.map_err(net("Mojang"))?;
    let uuid = normalize_uuid(&profile.id)
        .ok_or_else(|| CoreError::Network("Mojang devolvió un UUID ilegible".into()))?;
    if !valid_name(&profile.name) {
        return Err(CoreError::Network("Mojang devolvió un nombre ilegible".into()));
    }
    Ok(Player {
        uuid,
        name: profile.name,
        added: None,
        rank: None,
    })
}

// ───────────────────────────── Instancia del evento ─────────────────────────────

/// Deja la instancia del evento igual que la define el organizador. Devuelve su ID.
pub async fn sync_instance(
    paths: &ObsidiaPaths,
    instances: &InstanceStore,
    event: &EventInfo,
    reporter: &Reporter,
) -> Result<InstanceId> {
    let id = event_id(&event.id)?;
    let manifest = event.manifest.as_ref();
    if let Some(m) = manifest {
        if m.code != event.id {
            return Err(CoreError::invalid("el pack no corresponde a este evento"));
        }
        share::validate_manifest(m)?;
    }
    let def = NewInstance {
        name: event.name.clone(),
        minecraft_version: event.minecraft_version.clone(),
        loader: event.loader,
        loader_version: event.loader_version.clone(),
        memory: event
            .memory
            .or_else(|| manifest.and_then(|m| m.memory))
            .unwrap_or(DEFAULT_MEMORY),
        jvm_args: Vec::new(),
    };
    if instances.get(&id).is_ok() {
        instances.sync_event_definition(&id, def)?;
    } else {
        instances.create_with_id(id.clone(), def)?;
    }
    let dir = paths.instance_dir(&id);

    if let Some(m) = manifest {
        let hosts = share::hosts_in(m)?;
        let host_refs: Vec<&str> = hosts.iter().map(String::as_str).collect();
        let dl = Downloader::new(&host_refs)?;
        share::download_set(&dl, &dir.join("mods"), &m.mods, reporter, "Descargando mods del evento").await?;
        share::download_set(&dl, &dir.join("resourcepacks"), &m.resourcepacks, reporter, "Descargando resource packs").await?;
        share::download_set(&dl, &dir.join("shaderpacks"), &m.shaderpacks, reporter, "Descargando shaders").await?;
        share::download_set(&dl, &dir.join("config"), &m.config_files, reporter, "Descargando configuración").await?;
    }
    let allowed: HashSet<&str> = manifest
        .map(|m| m.mods.iter().map(|f| f.file_name.as_str()).collect())
        .unwrap_or_default();
    remove_foreign_mods(&dir.join("mods"), &allowed)?;
    sync_image(&dir, event).await;
    Ok(id)
}

/// Cliente privado: en la instancia de un evento solo hay los mods del evento.
fn remove_foreign_mods(mods_dir: &Path, allowed: &HashSet<&str>) -> Result<()> {
    let entries = match std::fs::read_dir(mods_dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(CoreError::io(mods_dir.to_path_buf(), e)),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else { continue };
        if allowed.contains(name.as_str()) {
            continue;
        }
        let path = entry.path();
        let removed = if kind.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        removed.map_err(|e| CoreError::io(path, e))?;
    }
    Ok(())
}

/// Descarga la imagen de un evento (solo https, hasta 15 MB).
async fn download_image(url: &str) -> Result<Vec<u8>> {
    let parsed = reqwest::Url::parse(url).map_err(|_| CoreError::invalid("la URL de la imagen no es válida"))?;
    if parsed.scheme() != "https" {
        return Err(CoreError::invalid("la imagen del evento debe ser https"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| CoreError::invalid("la URL de la imagen no tiene servidor"))?
        .to_owned();
    Downloader::new(&[host.as_str()])?
        .fetch_bytes(url, share::MAX_BACKGROUND_BYTES)
        .await
}

/// Imagen de un evento para la pantalla de inicio, sin esperar a jugar.
///
/// Se guarda en `<datos>/event-images/<EVT-…>.<ext>` junto a un `.url` con la
/// dirección de la que salió: solo se vuelve a descargar si el evento la cambia.
/// Sin `url` (el evento ya no tiene imagen) se borra la copia.
pub async fn event_image(paths: &ObsidiaPaths, id: &str, url: Option<&str>) -> Result<Option<(String, Vec<u8>)>> {
    let id = event_id(id)?;
    let stem = id.as_str();
    let dir = paths.data_dir().join("event-images");
    let marker = dir.join(format!("{stem}.url"));
    let Some(url) = url.map(str::trim).filter(|u| !u.is_empty()) else {
        if dir.exists() {
            background::clear_named(&dir, stem)?;
        }
        let _ = std::fs::remove_file(&marker);
        return Ok(None);
    };
    if std::fs::read_to_string(&marker).ok().as_deref() == Some(url) {
        if let Some(cached) = background::load_named(&dir, stem)? {
            return Ok(Some(cached));
        }
    }
    let bytes = download_image(url).await?;
    let mime = background::sniff_mime(&bytes)
        .ok_or_else(|| CoreError::invalid("la imagen del evento no es PNG, JPG, WEBP ni GIF"))?;
    std::fs::create_dir_all(&dir).map_err(|e| CoreError::io(&dir, e))?;
    background::save_named(&dir, stem, mime, &bytes)?;
    std::fs::write(&marker, url).map_err(|e| CoreError::io(&marker, e))?;
    Ok(Some((mime.to_owned(), bytes)))
}

/// Descarga la imagen del evento si cambió. Un fallo no impide jugar.
async fn sync_image(dir: &Path, event: &EventInfo) {
    let marker = dir.join(IMAGE_MARKER);
    let current = std::fs::read_to_string(&marker).ok();
    match &event.image_url {
        Some(url) if current.as_deref() != Some(url.as_str()) => {
            if let Ok(bytes) = download_image(url).await {
                if background::save_detected(dir, &bytes).is_ok() {
                    let _ = std::fs::write(&marker, url);
                }
            }
        }
        None if current.is_some() => {
            let _ = background::clear(dir);
            let _ = std::fs::remove_file(&marker);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuids_and_names() {
        assert_eq!(
            normalize_uuid("0123ABCD-4567-89ab-cdef-0123456789AB").as_deref(),
            Some("0123abcd456789abcdef0123456789ab")
        );
        assert!(normalize_uuid("no-es-un-uuid").is_none());
        assert!(valid_name("Jugador_1"));
        assert!(!valid_name("con espacio"));
        assert!(!valid_name("a".repeat(17).as_str()));
    }

    #[test]
    fn ranks_from_server() {
        // Servidor nuevo: rango y permisos tal cual.
        let me: MyEvents = serde_json::from_str(
            r#"{"uuid":"a","admin":true,"rank":"staff","permissions":{"manage_whitelist":true,"manage_ranks":true,"manage_events":false,"assignable":["invitado","miembro"]},"events":[]}"#,
        )
        .unwrap();
        assert_eq!(me.rank.as_deref(), Some("staff"));
        assert!(!me.permissions.manage_events);
        assert_eq!(me.permissions.assignable, ["invitado", "miembro"]);
        // Servidor antiguo: sin rango; los permisos quedan vacíos (my_events los completa).
        let old: MyEvents = serde_json::from_str(r#"{"uuid":"a","admin":true,"events":[]}"#).unwrap();
        assert!(old.rank.is_none() && !old.permissions.manage_events);
        // El rango del jugador solo se envía si se quiere cambiar.
        let p = Player { uuid: "u".into(), name: "n".into(), added: None, rank: None };
        assert!(!serde_json::to_string(&p).unwrap().contains("rank"));
    }

    #[tokio::test]
    async fn event_image_is_cached_by_url() {
        let tmp = std::env::temp_dir().join(format!("obsidia-ev-img-{}", std::process::id()));
        let paths = ObsidiaPaths::new(tmp.join("config"), tmp.join("data"));
        let dir = tmp.join("data").join("event-images");
        let png: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR";
        let url = "https://eventos.example/files/abc";
        std::fs::create_dir_all(&dir).unwrap();
        background::save_named(&dir, "EVT-ABC123", "image/png", png).unwrap();
        std::fs::write(dir.join("EVT-ABC123.url"), url).unwrap();

        // Misma URL: sale de la caché, sin tocar la red.
        let (mime, bytes) = event_image(&paths, "EVT-ABC123", Some(url)).await.unwrap().unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, png);
        // Otra URL que no es https: no se descarga nada.
        assert!(event_image(&paths, "EVT-ABC123", Some("http://eventos.example/x")).await.is_err());
        // Un id que no es de evento no puede escribir fuera de la carpeta.
        assert!(event_image(&paths, "../EVT-AB", Some(url)).await.is_err());
        // Sin imagen: se borra la copia.
        assert!(event_image(&paths, "EVT-ABC123", None).await.unwrap().is_none());
        assert!(background::load_named(&dir, "EVT-ABC123").unwrap().is_none());
        assert!(!dir.join("EVT-ABC123.url").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn event_ids_only() {
        assert!(event_id("EVT-ABC123").is_ok());
        assert!(event_id("OBS-ABC123").is_err());
        assert!(event_id("../EVT-AB").is_err());
    }

    #[test]
    fn foreign_mods_are_removed() {
        let tmp = std::env::temp_dir().join(format!("obsidia-ev-{}", std::process::id()));
        let mods = tmp.join("mods");
        std::fs::create_dir_all(mods.join("subcarpeta")).unwrap();
        for f in ["evento.jar", "trampa.jar", "otro.jar.disabled"] {
            std::fs::write(mods.join(f), b"x").unwrap();
        }
        let allowed = HashSet::from(["evento.jar"]);
        remove_foreign_mods(&mods, &allowed).unwrap();
        let left: Vec<_> = std::fs::read_dir(&mods)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(left, ["evento.jar"]);
        std::fs::remove_dir_all(tmp).unwrap();
    }
}
