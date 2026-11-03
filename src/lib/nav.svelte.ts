/** Navegación global: cualquier componente puede llevar a otra sección. */

export type Page = "home" | "admin" | "settings";
export type SettingsSection =
  | "general"
  | "account"
  | "skin"
  | "minecraft"
  | "java"
  | "appearance"
  | "server"
  | "updates"
  | "about";

class NavState {
  page = $state<Page>("home");
  settingsSection = $state<SettingsSection>("general");
  /** Evento cuyos registros se muestran (panel lateral de Inicio). */
  logsFor = $state<string | null>(null);

  go(page: Page) {
    this.page = page;
  }

  openSettings(section: SettingsSection) {
    this.settingsSection = section;
    this.page = "settings";
  }

  openLogs(id: string) {
    this.logsFor = id;
    this.page = "home";
  }
}

export const nav = new NavState();
