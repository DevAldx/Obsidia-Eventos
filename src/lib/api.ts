import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  JavaRuntime,
  InstanceList,
  UpdateCheck,
  BackgroundView,
  Settings,
  StartupProgress,
  VersionSummary,
  Account,
  SignInCodeEvent,
  NewsFeed,
  SkinProfile,
  SkinVariant,
  LibrarySkin,
  MyEvents,
  AdminEvent,
  EventInput,
  Player,
  MembersView,
  Rank,
} from "./types";

/** Los comandos de Rust fallan con `{ message }`; lo normalizamos a Error. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const msg =
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
    throw new Error(msg);
  }
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  getStartupProgress: () => call<StartupProgress>("get_startup_progress"),
  splashReady: () => call<void>("splash_ready"),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  listInstances: () => call<InstanceList>("list_instances"),
  getAccount: () => call<Account | null>("get_account"),
  getSignInCode: () => call<SignInCodeEvent | null>("get_sign_in_code"),
  beginSignIn: () => call<SignInCodeEvent>("begin_sign_in"),
  beginLegacySignIn: () => call<SignInCodeEvent>("begin_legacy_sign_in"),
  cancelSignIn: () => call<void>("cancel_sign_in"),
  signOut: () => call<void>("sign_out"),
  listJava: () => call<JavaRuntime[]>("list_java_runtimes"),
  listVersions: () => call<VersionSummary[]>("list_minecraft_versions"),
  stop: (id: string) => call<void>("stop_instance", { id }),
  gameStates: () => call<Record<string, string>>("game_states"),
  openUrl: (url: string) => call<void>("open_url", { url }),
  openHttpsUrl: (url: string) => call<void>("open_https_url", { url }),
  checkForUpdates: () => call<UpdateCheck>("check_for_updates"),
  getInstanceBackground: (instanceId: string) => call<BackgroundView | null>("get_instance_background", { instanceId }),
  getEventImage: (eventId: string, imageUrl: string | null) =>
    call<BackgroundView | null>("get_event_image", { eventId, imageUrl }),
  getLauncherBackground: () => call<BackgroundView | null>("get_launcher_background"),
  setLauncherBackground: (mime: string, dataBase64: string) =>
    call<void>("set_launcher_background", { mime, dataBase64 }),
  clearLauncherBackground: () => call<void>("clear_launcher_background"),
  getLauncherIcon: () => call<BackgroundView | null>("get_launcher_icon"),
  setLauncherIcon: (mime: string, dataBase64: string) =>
    call<void>("set_launcher_icon", { mime, dataBase64 }),
  clearLauncherIcon: () => call<void>("clear_launcher_icon"),
  openInstanceFolder: (instanceId: string, sub: "" | "screenshots") =>
    call<void>("open_instance_folder", { instanceId, sub }),
  checkAndPrepareUpdate: () => call<ObsidiaUpdateStatus>("check_and_prepare_update"),
  installUpdate: () => call<void>("install_update"),
  fetchNews: (force = false) => call<NewsFeed>("fetch_news", { force }),
  getSkinProfile: () => call<SkinProfile>("get_skin_profile"),
  uploadSkin: (name: string, variant: SkinVariant, dataBase64: string) =>
    call<SkinProfile>("upload_skin", { name, variant, dataBase64 }),
  applyLibrarySkin: (id: string) => call<SkinProfile>("apply_library_skin", { id }),
  resetSkin: () => call<SkinProfile>("reset_skin"),
  setCape: (capeId: string | null) => call<SkinProfile>("set_cape", { capeId }),
  listSkinLibrary: () => call<LibrarySkin[]>("list_skin_library"),
  deleteLibrarySkin: (id: string) => call<void>("delete_library_skin", { id }),

  // Eventos (la whitelist se comprueba en el servidor)
  eventsMe: () => call<MyEvents>("events_me"),
  eventPlay: (id: string) => call<void>("event_play", { id }),

  // Administración
  adminEventsList: () => call<AdminEvent[]>("admin_events_list"),
  adminEventSave: (id: string | null, input: EventInput) =>
    call<AdminEvent>("admin_event_save", { id, input }),
  adminEventDelete: (id: string) => call<void>("admin_event_delete", { id }),
  adminResolvePlayer: (query: string) => call<Player>("admin_resolve_player", { query }),
  adminPlayersAdd: (id: string, players: Player[]) =>
    call<Player[]>("admin_players_add", { id, players }),
  adminPlayerRemove: (id: string, uuid: string) =>
    call<Player[]>("admin_player_remove", { id, uuid }),
  adminMembersList: () => call<MembersView>("admin_members_list"),
  adminMemberSet: (uuid: string, name: string, rank: Rank) =>
    call<void>("admin_member_set", { uuid, name, rank }),
};

/** "-Xmx2G -XX:+UseG1GC" → ["-Xmx2G", "-XX:+UseG1GC"] */
export const splitArgs = (s: string): string[] => s.split(/\s+/).filter(Boolean);
export const joinArgs = (a: string[]): string => a.join(" ");

export type ObsidiaUpdateInfo = {
  version: string;
  current_version: string;
  notes?: string | null;
};

export type ObsidiaUpdateStatus = {
  available: boolean;
  update: ObsidiaUpdateInfo | null;
};

/** Servidor de eventos. Debe coincidir con `DEFAULT_SHARE_URL` de `obsidia-core`. */
export const DEFAULT_SHARE_URL = "https://obsidia-eventos.obsidia-share.workers.dev";
