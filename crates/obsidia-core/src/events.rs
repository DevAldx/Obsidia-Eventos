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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyEvents {
    pub uuid: String,
    pub admin: bool,
    pub events: Vec<EventInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    /// UUID sin guiones.
    pub uuid: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added: Option<String>,
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
    Ok(me)
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

/// Descarga la imagen del evento si cambió. Un fallo no impide jugar.
async fn sync_image(dir: &Path, event: &EventInfo) {
    let marker = dir.join(IMAGE_MARKER);
    let current = std::fs::read_to_string(&marker).ok();
    match &event.image_url {
        Some(url) if current.as_deref() != Some(url.as_str()) => {
            let Ok(parsed) = reqwest::Url::parse(url) else { return };
            let Some(host) = parsed.host_str().map(str::to_owned) else { return };
            if parsed.scheme() != "https" {
                return;
            }
            let Ok(dl) = Downloader::new(&[host.as_str()]) else { return };
            if let Ok(bytes) = dl.fetch_bytes(url, share::MAX_BACKGROUND_BYTES).await {
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
