//! Tipos del JSON de versión de Mojang, evaluación de reglas y resolución de libraries.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{error::CoreError, Result};

// ───────────────────────── Manifiesto de versiones ─────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub versions: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub sha1: Option<String>,
    #[serde(rename = "releaseTime")]
    pub release_time: Option<String>,
}

/// Lo que se muestra en la UI para elegir versión.
#[derive(Debug, Clone, Serialize)]
pub struct VersionSummary {
    pub id: String,
    /// `release`, `snapshot`, `old_beta`, `old_alpha`.
    pub kind: String,
    pub release_time: Option<String>,
}

// ───────────────────────────── JSON de versión ─────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct VersionMeta {
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(rename = "assetIndex")]
    pub asset_index: AssetIndexRef,
    pub downloads: VersionDownloads,
    #[serde(default)]
    pub libraries: Vec<Library>,
    pub arguments: Option<Arguments>,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
    #[serde(rename = "javaVersion")]
    pub java_version: Option<JavaVersionReq>,
    pub logging: Option<Logging>,
    #[serde(rename = "inheritsFrom")]
    pub inherits_from: Option<String>,
    #[serde(rename = "releaseTime")]
    pub release_time: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteFile {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionDownloads {
    pub client: RemoteFile,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JavaVersionReq {
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Logging {
    pub client: Option<LoggingClient>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingClient {
    pub argument: String,
    pub file: LoggingFile,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingFile {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Arg>,
    #[serde(default)]
    pub jvm: Vec<Arg>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Arg {
    Plain(String),
    Conditional {
        #[serde(default)]
        rules: Vec<Rule>,
        value: ArgValue,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ArgValue {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
    #[serde(default)]
    pub r#virtual: bool,
    #[serde(default)]
    pub map_to_resources: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

// ─────────────────────────────── Reglas ───────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub action: RuleAction,
    pub os: Option<OsRule>,
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction {
    Allow,
    Disallow,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<String>,
}

/// Arquitectura con el nombre que usa Mojang en sus reglas.
pub fn mojang_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        other => other,
    }
}

/// Sistema operativo con el nombre que usa Mojang en sus reglas.
pub fn mojang_os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// Sistema y arquitectura para los que se eligen libraries, natives y argumentos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Platform {
    /// `linux`, `windows` u `osx`.
    pub os: &'static str,
    /// `x86_64`, `arm64` o `x86`.
    pub arch: &'static str,
}

impl Platform {
    /// El equipo en el que corre el launcher.
    pub fn current() -> Self {
        Self {
            os: mojang_os(),
            arch: mojang_arch(),
        }
    }

    /// `${arch}` de los clasificadores de natives antiguos (`natives-windows-${arch}`).
    fn bits(self) -> &'static str {
        if self.arch == "x86" {
            "32"
        } else {
            "64"
        }
    }
}

fn os_matches(os: &OsRule, platform: Platform) -> bool {
    if os.name.as_deref().is_some_and(|n| n != platform.os) {
        return false;
    }
    if os.arch.as_deref().is_some_and(|a| a != platform.arch) {
        return false;
    }
    // Las reglas por versión de SO solo añaden ajustes (p. ej. `-Dos.name=Windows 10`)
    // que no hacen falta: no se aplican.
    os.version.is_none()
}

/// Evalúa una lista de reglas en este equipo. Vacía = permitido; si no, gana la última que coincida.
pub fn rules_allow(rules: &[Rule], features: &HashSet<&str>) -> bool {
    rules_allow_on(rules, features, Platform::current())
}

/// Como [`rules_allow`], para una plataforma concreta.
pub fn rules_allow_on(rules: &[Rule], features: &HashSet<&str>, platform: Platform) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        let os_ok = rule.os.as_ref().is_none_or(|os| os_matches(os, platform));
        let feat_ok = rule.features.as_ref().is_none_or(|f| {
            f.iter()
                .all(|(name, want)| features.contains(name.as_str()) == *want)
        });
        if os_ok && feat_ok {
            allowed = rule.action == RuleAction::Allow;
        }
    }
    allowed
}

// ───────────────────────────── Libraries ──────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibDownloads>,
    pub url: Option<String>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    pub natives: Option<HashMap<String, String>>,
    pub extract: Option<Extract>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LibDownloads {
    pub artifact: Option<RemoteFile>,
    pub classifiers: Option<HashMap<String, RemoteFile>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Extract {
    #[serde(default)]
    pub exclude: Vec<String>,
}

/// Archivo concreto de una library: ruta relativa a `libraries/` + origen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibFile {
    pub rel_path: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

/// Library ya filtrada por las reglas de la plataforma.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedLib {
    pub name: String,
    /// Jar que va al classpath.
    pub artifact: Option<LibFile>,
    /// Jar de natives que hay que extraer (clasificador antiguo o `:natives-linux`).
    pub native: Option<LibFile>,
    pub extract_exclude: Vec<String>,
}

const DEFAULT_LIB_REPO: &str = "https://libraries.minecraft.net/";

/// `group:artifact:version[:classifier][@ext]` → `group/artifact/version/artifact-version[-classifier].ext`
pub fn maven_path(name: &str) -> Result<String> {
    let (coords, ext) = name.split_once('@').unwrap_or((name, "jar"));
    let parts: Vec<&str> = coords.split(':').collect();
    let (group, artifact, version, classifier) = match parts.as_slice() {
        [g, a, v] => (*g, *a, *v, None),
        [g, a, v, c] => (*g, *a, *v, Some(*c)),
        _ => {
            return Err(CoreError::invalid(format!(
                "coordenadas de library inválidas: {name}"
            )))
        }
    };
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    Ok(format!("{}/{artifact}/{version}/{file}", group.replace('.', "/")))
}

fn file_from(remote: &RemoteFile, fallback_path: impl FnOnce() -> Result<String>) -> Result<LibFile> {
    Ok(LibFile {
        rel_path: match &remote.path {
            Some(p) => p.clone(),
            None => fallback_path()?,
        },
        url: remote.url.clone(),
        sha1: remote.sha1.clone(),
        size: remote.size,
    })
}

/// Libraries aplicables a este equipo, sin duplicados por ruta.
pub fn resolve_libraries(meta: &VersionMeta, features: &HashSet<&str>) -> Result<Vec<ResolvedLib>> {
    resolve_libraries_on(meta, features, Platform::current())
}

/// Como [`resolve_libraries`], para una plataforma concreta.
pub fn resolve_libraries_on(
    meta: &VersionMeta,
    features: &HashSet<&str>,
    platform: Platform,
) -> Result<Vec<ResolvedLib>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for lib in &meta.libraries {
        if !rules_allow_on(&lib.rules, features, platform) {
            continue;
        }
        let downloads = lib.downloads.as_ref();
        let mut artifact = None;
        let mut native = None;

        // Clasificador de natives antiguo (≤ 1.18): `natives: { windows: "natives-windows" }`.
        if let Some(natives) = &lib.natives {
            if let Some(classifier) = natives.get(platform.os) {
                let classifier = classifier.replace("${arch}", platform.bits());
                let remote = downloads
                    .and_then(|d| d.classifiers.as_ref())
                    .and_then(|c| c.get(&classifier))
                    .ok_or_else(|| {
                        CoreError::Launch(format!(
                            "{}: falta el clasificador de natives {classifier}",
                            lib.name
                        ))
                    })?;
                native = Some(file_from(remote, || {
                    maven_path(&format!("{}:{classifier}", lib.name))
                })?);
            }
        } else if let Some(remote) = downloads.and_then(|d| d.artifact.as_ref()) {
            let file = file_from(remote, || maven_path(&lib.name))?;
            // Estilo nuevo: la library de natives es un artefacto más (`…:natives-windows`).
            if lib.name.split(':').nth(3).is_some_and(|c| c.starts_with("natives-")) {
                native = Some(file.clone());
            }
            artifact = Some(file);
        } else if downloads.is_none() {
            // Metadatos muy antiguos: sin `downloads`, repositorio Maven + ruta por nombre.
            let path = maven_path(&lib.name)?;
            let base = lib.url.as_deref().unwrap_or(DEFAULT_LIB_REPO);
            artifact = Some(LibFile {
                url: format!("{}/{path}", base.trim_end_matches('/')),
                rel_path: path,
                sha1: None,
                size: None,
            });
        }

        let dup = artifact
            .as_ref()
            .or(native.as_ref())
            .is_none_or(|f| !seen.insert(f.rel_path.clone()));
        if dup {
            continue;
        }
        out.push(ResolvedLib {
            name: lib.name.clone(),
            artifact,
            native,
            extract_exclude: lib
                .extract
                .as_ref()
                .map(|e| e.exclude.clone())
                .unwrap_or_else(|| vec!["META-INF/".to_owned()]),
        });
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod fixtures {
    /// Estilo antiguo (1.8.9): `minecraftArguments`, natives por clasificador, sin `downloads` en una library.
    pub const LEGACY: &str = r#"{
      "id": "1.8.9", "type": "release", "releaseTime": "2015-12-09T10:00:00+00:00",
      "mainClass": "net.minecraft.client.main.Main",
      "minecraftArguments": "--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userProperties ${user_properties} --userType ${user_type}",
      "assetIndex": {"id": "1.8", "sha1": "aa", "size": 10, "url": "https://piston-meta.mojang.com/v1/packages/aa/1.8.json"},
      "downloads": {"client": {"sha1": "bb", "size": 100, "url": "https://piston-data.mojang.com/v1/objects/bb/client.jar"}},
      "libraries": [
        {"name": "com.google.code.gson:gson:2.2.4", "downloads": {"artifact": {"path": "com/google/code/gson/gson/2.2.4/gson-2.2.4.jar", "sha1": "cc", "size": 5, "url": "https://libraries.minecraft.net/com/google/code/gson/gson/2.2.4/gson-2.2.4.jar"}}},
        {"name": "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209",
         "natives": {"linux": "natives-linux", "windows": "natives-windows", "osx": "natives-osx"},
         "extract": {"exclude": ["META-INF/"]},
         "downloads": {"classifiers": {
           "natives-linux": {"path": "org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-linux.jar", "sha1": "dd", "size": 7, "url": "https://libraries.minecraft.net/x-linux.jar"},
           "natives-windows": {"path": "org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar", "sha1": "de", "size": 7, "url": "https://libraries.minecraft.net/x-windows.jar"},
           "natives-osx": {"path": "org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-osx.jar", "sha1": "df", "size": 7, "url": "https://libraries.minecraft.net/x-osx.jar"}}}},
        {"name": "net.java.jinput:jinput-platform:2.0.5",
         "natives": {"windows": "natives-windows"},
         "downloads": {"classifiers": {"natives-windows": {"path": "w.jar", "sha1": "ee", "size": 1, "url": "https://libraries.minecraft.net/w.jar"}}}},
        {"name": "oshi:solo:1.0", "rules": [{"action": "allow", "os": {"name": "osx"}}],
         "downloads": {"artifact": {"path": "oshi/solo/1.0/solo-1.0.jar", "sha1": "ff", "size": 1, "url": "https://libraries.minecraft.net/solo.jar"}}},
        {"name": "old.group:oldlib:1.0"}
      ]
    }"#;

    /// Estilo nuevo (1.21): `arguments` con reglas, natives como artefacto `:natives-linux`, logging y javaVersion.
    pub const MODERN: &str = r#"{
      "id": "1.21.1", "type": "release", "releaseTime": "2024-08-08T12:24:45+00:00",
      "mainClass": "net.minecraft.client.main.Main",
      "javaVersion": {"component": "java-runtime-delta", "majorVersion": 21},
      "arguments": {
        "game": [
          "--username", "${auth_player_name}", "--version", "${version_name}",
          "--gameDir", "${game_directory}", "--assetsDir", "${assets_root}",
          "--assetIndex", "${assets_index_name}", "--uuid", "${auth_uuid}",
          "--accessToken", "${auth_access_token}", "--clientId", "${clientid}",
          "--xuid", "${auth_xuid}", "--userType", "${user_type}", "--versionType", "${version_type}",
          {"rules": [{"action": "allow", "features": {"is_demo_user": true}}], "value": "--demo"},
          {"rules": [{"action": "allow", "features": {"has_custom_resolution": true}}], "value": ["--width", "${resolution_width}", "--height", "${resolution_height}"]}
        ],
        "jvm": [
          {"rules": [{"action": "allow", "os": {"name": "osx"}}], "value": ["-XstartOnFirstThread"]},
          {"rules": [{"action": "allow", "os": {"name": "windows"}}], "value": "-XX:HeapDumpPath=x"},
          "-Djava.library.path=${natives_directory}",
          "-Dminecraft.launcher.brand=${launcher_name}",
          "-Dminecraft.launcher.version=${launcher_version}",
          "-cp", "${classpath}"
        ]
      },
      "assetIndex": {"id": "17", "sha1": "aa", "size": 10, "url": "https://piston-meta.mojang.com/v1/packages/aa/17.json"},
      "downloads": {"client": {"sha1": "bb", "size": 100, "url": "https://piston-data.mojang.com/v1/objects/bb/client.jar"}},
      "logging": {"client": {"argument": "-Dlog4j.configurationFile=${path}", "file": {"id": "client-1.12.xml", "sha1": "11", "size": 3, "url": "https://piston-data.mojang.com/v1/objects/11/client-1.12.xml"}}},
      "libraries": [
        {"name": "org.lwjgl:lwjgl:3.3.3", "downloads": {"artifact": {"path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar", "sha1": "a1", "size": 1, "url": "https://libraries.minecraft.net/lwjgl.jar"}}},
        {"name": "org.lwjgl:lwjgl:3.3.3:natives-linux",
         "rules": [{"action": "allow", "os": {"name": "linux"}}],
         "downloads": {"artifact": {"path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar", "sha1": "a2", "size": 1, "url": "https://libraries.minecraft.net/lwjgl-natives-linux.jar"}}},
        {"name": "org.lwjgl:lwjgl:3.3.3:natives-windows",
         "rules": [{"action": "allow", "os": {"name": "windows"}}],
         "downloads": {"artifact": {"path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar", "sha1": "a3", "size": 1, "url": "https://libraries.minecraft.net/lwjgl-natives-windows.jar"}}},
        {"name": "org.lwjgl:lwjgl:3.3.3:natives-linux-arm64",
         "rules": [{"action": "allow", "os": {"name": "linux", "arch": "arm64"}}],
         "downloads": {"artifact": {"path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux-arm64.jar", "sha1": "a4", "size": 1, "url": "https://libraries.minecraft.net/lwjgl-natives-linux-arm64.jar"}}},
        {"name": "org.lwjgl:lwjgl:3.3.3", "downloads": {"artifact": {"path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar", "sha1": "a1", "size": 1, "url": "https://libraries.minecraft.net/lwjgl.jar"}}}
      ]
    }"#;
}

#[cfg(test)]
mod tests {
    use super::fixtures::{LEGACY, MODERN};
    use super::*;

    fn parse(s: &str) -> VersionMeta {
        serde_json::from_str(s).expect("fixture JSON")
    }

    fn feats(names: &[&'static str]) -> HashSet<&'static str> {
        names.iter().copied().collect()
    }

    const LINUX: Platform = Platform { os: "linux", arch: "x86_64" };
    const WINDOWS: Platform = Platform { os: "windows", arch: "x86_64" };

    fn rules(json: &str) -> Vec<Rule> {
        serde_json::from_str(json).expect("rules")
    }

    #[test]
    fn rules_semantics() {
        let none = feats(&[]);
        let allow_osx = rules(r#"[{"action":"allow","os":{"name":"osx"}}]"#);
        assert!(!rules_allow_on(&allow_osx, &none, LINUX));
        assert!(!rules_allow_on(&allow_osx, &none, WINDOWS));
        assert!(rules_allow_on(&[], &none, LINUX));

        // "allow todo, salvo osx"
        let except_osx = rules(r#"[{"action":"allow"},{"action":"disallow","os":{"name":"osx"}}]"#);
        assert!(rules_allow_on(&except_osx, &none, LINUX));
        assert!(rules_allow_on(&except_osx, &none, WINDOWS));

        let only_windows = rules(r#"[{"action":"allow","os":{"name":"windows"}}]"#);
        assert!(rules_allow_on(&only_windows, &none, WINDOWS));
        assert!(!rules_allow_on(&only_windows, &none, LINUX));

        // natives-windows-x86 es solo para Windows de 32 bits.
        let windows_x86 = rules(r#"[{"action":"allow","os":{"name":"windows","arch":"x86"}}]"#);
        assert!(!rules_allow_on(&windows_x86, &none, WINDOWS));

        // Las reglas por versión de SO no se aplican.
        let win10 = rules(r#"[{"action":"allow","os":{"name":"windows","version":"^10\\."}}]"#);
        assert!(!rules_allow_on(&win10, &none, WINDOWS));

        let demo = rules(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#);
        assert!(!rules_allow_on(&demo, &none, LINUX));
        assert!(rules_allow_on(&demo, &feats(&["is_demo_user"]), LINUX));
    }

    #[test]
    fn current_platform_is_this_machine() {
        let p = Platform::current();
        assert_eq!(p.os, if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "osx" } else { "linux" });
    }

    #[test]
    fn maven_paths() {
        assert_eq!(
            maven_path("com.google.code.gson:gson:2.2.4").unwrap_or_default(),
            "com/google/code/gson/gson/2.2.4/gson-2.2.4.jar"
        );
        assert_eq!(
            maven_path("org.lwjgl:lwjgl:3.3.3:natives-linux").unwrap_or_default(),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar"
        );
        assert!(maven_path("roto").is_err());
    }

    #[test]
    fn legacy_libraries_resolve_for_linux() {
        let libs = resolve_libraries_on(&parse(LEGACY), &feats(&[]), LINUX).expect("resolve");
        let names: Vec<_> = libs.iter().map(|l| l.name.as_str()).collect();
        // jinput solo tiene natives de Windows y oshi es de macOS: ambas fuera.
        assert_eq!(
            names,
            [
                "com.google.code.gson:gson:2.2.4",
                "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209",
                "old.group:oldlib:1.0"
            ]
        );
        assert!(libs[0].artifact.is_some() && libs[0].native.is_none());
        assert!(libs[1].artifact.is_none(), "el jar de natives no va al classpath");
        assert!(libs[1].native.as_ref().is_some_and(|n| n.rel_path.ends_with("natives-linux.jar")));
        let old = libs[2].artifact.as_ref().expect("artifact");
        assert_eq!(old.url, "https://libraries.minecraft.net/old/group/oldlib/1.0/oldlib-1.0.jar");
        assert!(old.sha1.is_none());
    }

    #[test]
    fn legacy_libraries_resolve_for_windows() {
        let libs = resolve_libraries_on(&parse(LEGACY), &feats(&[]), WINDOWS).expect("resolve");
        let names: Vec<_> = libs.iter().map(|l| l.name.as_str()).collect();
        // En Windows sí entra jinput (solo tiene natives de Windows); oshi sigue fuera.
        assert_eq!(
            names,
            [
                "com.google.code.gson:gson:2.2.4",
                "org.lwjgl.lwjgl:lwjgl-platform:2.9.4-nightly-20150209",
                "net.java.jinput:jinput-platform:2.0.5",
                "old.group:oldlib:1.0"
            ]
        );
        assert!(libs[1].native.as_ref().is_some_and(|n| n.rel_path.ends_with("natives-windows.jar")));
        assert!(libs[2].native.as_ref().is_some_and(|n| n.rel_path == "w.jar"));
    }

    fn modern_paths(platform: Platform) -> Vec<String> {
        let libs = resolve_libraries_on(&parse(MODERN), &feats(&[]), platform).expect("resolve");
        let natives = libs.iter().filter(|l| l.native.is_some()).count();
        let paths: Vec<String> = libs
            .iter()
            .filter_map(|l| l.artifact.as_ref().map(|a| a.rel_path.clone()))
            .collect();
        assert_eq!(natives, paths.len() - 1, "todo menos lwjgl base son natives");
        paths
    }

    #[test]
    fn modern_libraries_dedup_and_natives() {
        // lwjgl base (duplicada, una sola vez) + los natives del sistema, nunca los de otro.
        assert_eq!(
            modern_paths(LINUX),
            ["org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar", "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar"]
        );
        assert_eq!(
            modern_paths(WINDOWS),
            ["org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar", "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar"]
        );
        let linux_arm = modern_paths(Platform { os: "linux", arch: "arm64" });
        assert!(linux_arm.iter().any(|p| p.ends_with("natives-linux-arm64.jar")));
    }

    #[test]
    fn parses_arguments_and_logging() {
        let m = parse(MODERN);
        let args = m.arguments.expect("arguments");
        assert_eq!(args.jvm.len(), 7);
        assert!(m.logging.and_then(|l| l.client).is_some());
        assert_eq!(m.java_version.map(|j| j.major_version), Some(21));
    }
}
