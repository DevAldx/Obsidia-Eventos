<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/app.svelte";
  import { api, DEFAULT_SHARE_URL } from "../lib/api";
  import { toasts } from "../lib/toast.svelte";
  import type { AdminEvent, EventInput, Loader, Player } from "../lib/types";
  import Icon from "../components/Icon.svelte";
  import Modal from "../components/Modal.svelte";

  let list = $state<AdminEvent[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** ID abierto; `"new"` = creando uno. */
  let openId = $state<string | null>(null);
  const current = $derived(list.find((e) => e.id === openId) ?? null);

  type Draft = {
    name: string;
    description: string;
    server_address: string;
    image_url: string;
    pack_code: string;
    minecraft_version: string;
    loader: Loader;
    loader_version: string;
    memory_max: string;
    active: boolean;
  };
  let draft = $state<Draft>(emptyDraft());
  let saving = $state(false);
  let playerQuery = $state("");
  let adding = $state(false);
  let filter = $state("");
  /** Ventana de whitelist: abierta o no, y de qué evento. */
  let wlOpen = $state(false);
  let wlId = $state<string | null>(null);
  const wlEvent = $derived(list.find((e) => e.id === wlId) ?? null);

  function openWhitelist(id: string | null = null) {
    wlId = id ?? (current ? current.id : (list[0]?.id ?? null));
    playerQuery = "";
    filter = "";
    wlOpen = true;
  }

  function emptyDraft(): Draft {
    return {
      name: "",
      description: "",
      server_address: "",
      image_url: "",
      pack_code: "",
      minecraft_version: "1.21.1",
      loader: "vanilla",
      loader_version: "",
      memory_max: "4096",
      active: true,
    };
  }

  function toDraft(e: AdminEvent): Draft {
    return {
      name: e.name,
      description: e.description ?? "",
      server_address: e.server_address ?? "",
      image_url: e.image_url ?? "",
      pack_code: e.pack_code ?? "",
      minecraft_version: e.minecraft_version,
      loader: e.loader,
      loader_version: e.loader_version ?? "",
      memory_max: String(e.memory?.max_mb ?? ""),
      active: e.active,
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      list = await api.adminEventsList();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function open(id: string | null) {
    openId = id;
    const e = list.find((x) => x.id === id);
    draft = e ? toDraft(e) : emptyDraft();
  }

  const usesPack = $derived(draft.pack_code.trim() !== "");

  function input(): EventInput {
    const t = (s: string) => s.trim() || null;
    const max = Number(draft.memory_max);
    return {
      name: draft.name.trim(),
      description: t(draft.description),
      server_address: t(draft.server_address),
      image_url: t(draft.image_url),
      pack_code: t(draft.pack_code)?.toUpperCase() ?? null,
      minecraft_version: usesPack ? null : t(draft.minecraft_version),
      loader: usesPack ? null : draft.loader,
      loader_version: usesPack || draft.loader === "vanilla" ? null : t(draft.loader_version),
      memory: max > 0 ? { min_mb: Math.min(2048, max), max_mb: max } : null,
      active: draft.active,
    };
  }

  async function save() {
    saving = true;
    try {
      const saved = await api.adminEventSave(openId === "new" ? null : openId, input());
      const i = list.findIndex((e) => e.id === saved.id);
      if (i >= 0) list[i] = saved;
      else list = [saved, ...list];
      openId = saved.id;
      draft = toDraft(saved);
      toasts.success("Evento guardado");
      void app.loadEvents();
    } catch (e) {
      toasts.error(e, "No se pudo guardar");
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!current) return;
    if (!confirm(`¿Borrar «${current.name}» y su whitelist? No se puede deshacer.`)) return;
    try {
      await api.adminEventDelete(current.id);
      list = list.filter((e) => e.id !== current.id);
      openId = null;
      toasts.success("Evento borrado");
      void app.loadEvents();
    } catch (e) {
      toasts.error(e, "No se pudo borrar");
    }
  }

  /** Acepta varios nombres o UUIDs separados por comas, espacios o saltos de línea. */
  async function addPlayers() {
    const ev = wlEvent;
    if (!ev) return;
    const queries = playerQuery.split(/[\s,;]+/).map((q) => q.trim()).filter(Boolean);
    if (queries.length === 0) return;
    adding = true;
    const found: Player[] = [];
    const failed: string[] = [];
    for (const q of queries) {
      try {
        found.push(await api.adminResolvePlayer(q));
      } catch (e) {
        failed.push(`${q}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      if (found.length > 0) {
        ev.players = await api.adminPlayersAdd(ev.id, found);
        toasts.success(`${found.length} jugador(es) añadidos a la whitelist`);
      }
      playerQuery = failed.length > 0 ? queries.filter((q) => failed.some((f) => f.startsWith(`${q}:`))).join("\n") : "";
      if (failed.length > 0) toasts.error(failed.join("\n"), "No se encontraron");
    } catch (e) {
      toasts.error(e, "No se pudo actualizar la whitelist");
    } finally {
      adding = false;
    }
  }

  async function removePlayer(p: Player) {
    const ev = wlEvent;
    if (!ev) return;
    try {
      ev.players = await api.adminPlayerRemove(ev.id, p.uuid);
    } catch (e) {
      toasts.error(e, "No se pudo quitar");
    }
  }

  const shownPlayers = $derived(
    (wlEvent?.players ?? []).filter(
      (p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.uuid.includes(filter.toLowerCase()),
    ),
  );

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.success("Copiado");
    } catch {
      toasts.error("No se pudo copiar");
    }
  }

  const serverUrl = $derived((app.settings?.sharing.manifest_base_url || "").trim() || DEFAULT_SHARE_URL);
</script>

<div class="admin">
  <aside class="list">
    <div class="list-head">
      <p class="eyebrow">Eventos</p>
      <div class="head-actions">
        <button class="btn sm" onclick={() => openWhitelist()}><Icon name="user" size={14} /> Whitelist</button>
        <button class="btn sm primary" onclick={() => open("new")}><Icon name="plus" size={14} /> Nuevo</button>
      </div>
    </div>
    {#if loading && list.length === 0}
      <div class="skeleton item-skel"></div>
      <div class="skeleton item-skel"></div>
    {:else if error}
      <div class="alert"><Icon name="alert" size={16} /><span>{error}</span></div>
      <button class="btn sm" onclick={load}>Reintentar</button>
    {:else}
      {#each list as e (e.id)}
        <button class="item" class:current={openId === e.id} onclick={() => open(e.id)}>
          <span class="item-name">{e.name}</span>
          <span class="item-meta">
            {e.players.length} jugadores · {e.minecraft_version}
            {#if !e.active}<span class="tag ember sm">Cerrado</span>{/if}
          </span>
        </button>
      {:else}
        <p class="hint">Todavía no hay eventos. Crea el primero.</p>
      {/each}
    {/if}
  </aside>

  <section class="detail">
    {#if openId === null}
      <div class="empty">
        <Icon name="settings" size={32} />
        <h2 class="display">Panel de organizadores</h2>
        <p class="hint">
          Crea eventos y decide quién entra. Solo ven un evento las cuentas de su whitelist; el resto ve
          «Acceso restringido». Los cambios se aplican al momento.
        </p>
      </div>
    {:else}
      <div class="form">
        <div class="form-head">
          <div>
            <p class="eyebrow">{openId === "new" ? "Nuevo evento" : openId}</p>
            <h2 class="display">{draft.name || "Sin nombre"}</h2>
          </div>
          {#if current}
            <div class="head-actions">
              <button class="btn sm primary" onclick={() => openWhitelist(current.id)}>
                <Icon name="user" size={14} /> Whitelist ({current.players.length})
              </button>
              <button class="btn danger-soft sm" onclick={remove}><Icon name="trash" size={14} /> Borrar</button>
            </div>
          {/if}
        </div>

        <div class="grid">
          <label class="field wide">
            <span>Nombre</span>
            <input bind:value={draft.name} maxlength="48" placeholder="Torneo de invierno" />
          </label>
          <label class="field wide">
            <span>Descripción <span class="hint">(opcional)</span></span>
            <textarea bind:value={draft.description} maxlength="600" rows="3"></textarea>
          </label>
          <label class="field">
            <span>Servidor de Minecraft</span>
            <input class="mono" bind:value={draft.server_address} placeholder="mc.tuservidor.com:25565" />
          </label>
          <label class="field">
            <span>Pack del evento <span class="hint">(opcional)</span></span>
            <input class="mono" bind:value={draft.pack_code} placeholder="OBS-XXXXXX" maxlength="10" />
          </label>
          {#if !usesPack}
            <label class="field">
              <span>Versión de Minecraft</span>
              <input class="mono" bind:value={draft.minecraft_version} />
            </label>
            <label class="field">
              <span>Loader</span>
              <select bind:value={draft.loader}>
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
              </select>
            </label>
            {#if draft.loader === "fabric"}
              <label class="field">
                <span>Versión de Fabric Loader</span>
                <input class="mono" bind:value={draft.loader_version} placeholder="0.16.5" />
              </label>
            {/if}
          {/if}
          <label class="field">
            <span>Memoria máxima (MB)</span>
            <input type="number" min="1024" step="512" bind:value={draft.memory_max} />
          </label>
          <label class="field wide">
            <span>Imagen <span class="hint">(https, opcional; con pack se usa la suya)</span></span>
            <input class="mono" bind:value={draft.image_url} placeholder="https://…/portada.jpg" />
          </label>
          <label class="check wide">
            <input type="checkbox" bind:checked={draft.active} />
            <span>Abierto: los jugadores de la whitelist lo ven y pueden jugar</span>
          </label>
        </div>
        {#if usesPack}
          <p class="hint">
            Con pack, la versión, el loader y los mods salen del pack. Súbelo desde Obsidia normal con
            Compartir → «Subir al servidor», poniendo antes en Ajustes → Compartir la URL de este servidor
            de eventos ({serverUrl}). Al jugar, los mods que no estén en el pack se borran.
          </p>
        {/if}
        <div class="actions">
          <button class="btn primary" onclick={save} disabled={saving || !draft.name.trim()}>
            {saving ? "Guardando…" : openId === "new" ? "Crear evento" : "Guardar cambios"}
          </button>
        </div>

        {#if current}
          <p class="hint">Para decidir quién entra, pulsa <strong>Whitelist</strong> arriba.</p>
        {:else}
          <p class="hint">Crea el evento y luego añade a los jugadores con el botón <strong>Whitelist</strong>.</p>
        {/if}
      </div>
    {/if}
  </section>
</div>

{#if wlOpen}
  <Modal title="Whitelist" subtitle="Solo estas cuentas ven el evento y pueden jugarlo" width={620} busy={adding} onclose={() => (wlOpen = false)}>
    {#if list.length === 0}
      <p class="hint">Todavía no hay eventos. Crea uno primero: la whitelist es de cada evento.</p>
    {:else}
      <div class="whitelist">
        <label class="field">
          <span>Evento</span>
          <select bind:value={wlId} onchange={() => (filter = "")}>
            {#each list as e (e.id)}
              <option value={e.id}>{e.name}{e.active ? "" : " (cerrado)"}</option>
            {/each}
          </select>
        </label>
        {#if wlEvent}
          <div class="wl-head">
            <h3 class="display">{wlEvent.players.length} jugadores con acceso</h3>
            <button class="btn ghost sm" onclick={() => copy(wlEvent.players.map((p) => p.name).join("\n"))} disabled={wlEvent.players.length === 0}>
              <Icon name="layers" size={14} /> Copiar nombres
            </button>
          </div>
          <div class="add">
            <textarea
              bind:value={playerQuery}
              rows="2"
              placeholder="Nombres de Minecraft o UUIDs, separados por comas o saltos de línea"
              onkeydown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), addPlayers())}
            ></textarea>
            <button class="btn primary" onclick={addPlayers} disabled={adding || !playerQuery.trim()}>
              <Icon name="plus" size={15} /> {adding ? "Buscando…" : "Añadir"}
            </button>
          </div>
          <p class="hint">Enter para añadir · Shift+Enter para otra línea.</p>
          {#if wlEvent.players.length > 8}
            <input class="filter" bind:value={filter} placeholder="Buscar en la whitelist…" />
          {/if}
          <ul class="players">
            {#each shownPlayers as p (p.uuid)}
              <li>
                <span class="p-name">{p.name}</span>
                <span class="p-uuid mono">{p.uuid}</span>
                <button class="icon-btn" title="Quitar de la whitelist" onclick={() => removePlayer(p)}><Icon name="close" size={14} /></button>
              </li>
            {:else}
              <li class="hint">Nadie todavía. Añade a los participantes arriba.</li>
            {/each}
          </ul>
          <details class="advanced">
            <summary>Proteger también el servidor de Minecraft</summary>
            <p class="hint">
              El launcher solo enseña el evento a quien está en la lista, pero cualquiera que conozca la IP
              podría entrar con otro launcher. Activa <span class="mono">white-list=true</span> y
              <span class="mono">enforce-whitelist=true</span> en el servidor y sincroniza esta lista con:
            </p>
            <pre class="mono">curl -fsS -H "Authorization: Bearer $SERVER_KEY" \
  {serverUrl}/api/server/{wlEvent.id}/whitelist.json \
  -o whitelist.json && rcon-cli whitelist reload</pre>
            <button class="btn sm" onclick={() => copy(wlEvent.id)}>Copiar ID del evento</button>
          </details>
        {/if}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .admin {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
    min-height: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 14px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    background: rgb(var(--surface) / 0.5);
  }
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .item-skel {
    height: 52px;
    border-radius: 10px;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: none;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .item:hover,
  .item.current {
    background: rgb(255 255 255 / 0.05);
    border-color: var(--border);
  }
  .item.current {
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .item-name {
    font-weight: 600;
    font-size: 14px;
  }
  .item-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .detail {
    overflow-y: auto;
    padding: 24px 28px 40px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
    height: 100%;
    max-width: 460px;
    margin: 0 auto;
    color: var(--text-2);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 820px;
  }
  .form-head,
  .wl-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  textarea {
    resize: vertical;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .whitelist {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head-actions {
    display: flex;
    gap: 8px;
  }
  .add {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .add textarea {
    flex: 1;
  }
  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    max-height: 380px;
    overflow-y: auto;
  }
  .players li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .players li:last-child {
    border-bottom: none;
  }
  .p-name {
    font-weight: 600;
    min-width: 140px;
  }
  .p-uuid {
    flex: 1;
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: rgb(255 80 80 / 0.12);
    color: #ff9c9c;
  }
  .advanced pre {
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 12px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: #060509;
    border: 1px solid var(--border);
    user-select: text;
  }
  .advanced summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
  }
  .advanced {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
