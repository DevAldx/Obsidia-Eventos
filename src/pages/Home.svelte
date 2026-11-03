<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { api } from "../lib/api";
  import { nav } from "../lib/nav.svelte";
  import { toasts } from "../lib/toast.svelte";
  import { formatLastPlayed, formatMemory, formatPlaytime } from "../lib/format";
  import type { EventInfo } from "../lib/types";
  import PlayButton from "../components/PlayButton.svelte";
  import Icon from "../components/Icon.svelte";
  import LogView from "../components/LogView.svelte";
  import Logo from "../components/Logo.svelte";

  const events = $derived(app.me?.events ?? []);
  let selectedId = $state<string | null>(null);
  const event = $derived<EventInfo | null>(
    events.find((e) => e.id === selectedId) ?? events[0] ?? null,
  );
  const local = $derived(event ? app.list.instances.find((i) => i.id === event.id) : undefined);
  const bg = $derived(event ? app.backgrounds[event.id] : undefined);
  const modCount = $derived(event?.manifest?.mods.length ?? 0);

  $effect(() => {
    for (const e of events) void app.ensureBackground(e.id);
  });
  // Tras jugar por primera vez se descarga la imagen del evento.
  $effect(() => {
    if (event && local && bg === null) {
      app.invalidateBackground(event.id);
      void app.ensureBackground(event.id);
    }
  });

  const loaderText = (e: EventInfo) =>
    e.loader === "fabric" ? `Fabric ${e.loader_version ?? ""}`.trim() : "Vanilla";

  async function copyId() {
    if (!app.account) return;
    try {
      await navigator.clipboard.writeText(`${app.account.username} ${app.account.uuid}`);
      toasts.success("Copiado. Envíaselo al organizador del evento.");
    } catch {
      toasts.error("No se pudo copiar; selecciónalo a mano.");
    }
  }

  async function openFolder(id: string) {
    try {
      await api.openInstanceFolder(id, "screenshots");
    } catch (e) {
      toasts.error(e, "No se pudo abrir la carpeta");
    }
  }
</script>

<div class="home">
  {#if !app.account || app.account.kind !== "microsoft"}
    <!-- ───────────── Sin cuenta de Microsoft ───────────── -->
    <section class="gate obsidia-bg">
      <div class="gate-card">
        <Logo size={52} custom={app.launcherIcon} />
        <p class="eyebrow">Cliente privado</p>
        <h1 class="display">Obsidia Eventos</h1>
        <p class="hint">
          Solo pueden entrar los jugadores invitados. Inicia sesión con tu cuenta de Microsoft para ver
          los eventos a los que tienes acceso.
        </p>
        {#if app.account?.kind === "offline"}
          <div class="alert"><Icon name="alert" size={16} /><span>Las cuentas locales no sirven aquí. Cierra la sesión y entra con Microsoft.</span></div>
          <button class="btn" onclick={() => app.signOut()}><Icon name="logout" size={15} /> Cerrar sesión local</button>
        {:else}
          <button class="btn primary big-cta facet" onclick={() => app.startLegacySignIn()} disabled={app.signInBusy}>
            <Icon name="user" size={18} />
            {app.signInBusy ? "Esperando a Microsoft…" : "Iniciar sesión con Microsoft"}
          </button>
          <button class="btn ghost sm" onclick={() => nav.openSettings("account")}>Más opciones (Azure propia)…</button>
        {/if}
        {#if app.signInError}<p class="alert">{app.signInError}</p>{/if}
      </div>
    </section>
  {:else if app.eventsLoading && !app.me}
    <section class="gate obsidia-bg" aria-busy="true">
      <div class="gate-card">
        <Logo size={52} custom={app.launcherIcon} />
        <p class="hint">Comprobando tu acceso…</p>
      </div>
    </section>
  {:else if app.eventsError && !app.me}
    <section class="gate obsidia-bg">
      <div class="gate-card">
        <Icon name="wifiOff" size={32} />
        <h2 class="display">No se pudo contactar con el servidor de eventos</h2>
        <p class="alert">{app.eventsError}</p>
        <button class="btn primary" onclick={() => app.loadEvents()}><Icon name="refresh" size={15} /> Reintentar</button>
      </div>
    </section>
  {:else if events.length === 0}
    <!-- ───────────── Fuera de la whitelist ───────────── -->
    <section class="gate obsidia-bg">
      <div class="gate-card">
        <span class="lock"><Icon name="alert" size={26} /></span>
        <p class="eyebrow">Acceso restringido</p>
        <h1 class="display">No estás en ninguna whitelist</h1>
        <p class="hint">
          Este launcher es privado. Pide al organizador que te añada a su evento con estos datos; cuando lo
          haga, pulsa «Comprobar de nuevo».
        </p>
        <button class="idbox mono" onclick={copyId} title="Copiar">
          <span>{app.account.username}</span>
          <span class="muted">{app.account.uuid}</span>
          <Icon name="layers" size={15} />
        </button>
        <div class="row">
          <button class="btn primary" onclick={() => app.loadEvents()} disabled={app.eventsLoading}>
            <Icon name="refresh" size={15} /> {app.eventsLoading ? "Comprobando…" : "Comprobar de nuevo"}
          </button>
          {#if app.me?.admin}
            <button class="btn" onclick={() => nav.go("admin")}><Icon name="settings" size={15} /> Crear un evento</button>
          {/if}
        </div>
      </div>
    </section>
  {:else if event}
    <!-- ───────────── Evento seleccionado ───────────── -->
    <section class="stage" class:obsidia-bg={!bg} style:background-image={bg ? `url(${bg})` : undefined}>
      <div class="shade"></div>
      <div class="stage-main">
        <div class="tags">
          {#if app.games[event.id] === "running"}
            <span class="tag ok"><span class="dot live"></span> En juego</span>
          {:else if local?.installed}
            <span class="tag ok">Listo para jugar</span>
          {:else}
            <span class="tag ember" title="Minecraft, Java y los mods del evento se descargan al pulsar Jugar.">Se descargará al jugar</span>
          {/if}
          {#if !event.active}<span class="tag ember">Cerrado · solo admins</span>{/if}
          <span class="tag">{loaderText(event)}</span>
          <span class="tag">Minecraft {event.minecraft_version}</span>
        </div>

        <h1 class="title">{event.name}</h1>
        {#if event.description}<p class="desc">{event.description}</p>{/if}

        <p class="meta">
          {#if modCount > 0}<span><Icon name="puzzle" size={14} /> {modCount} mods del evento</span>{/if}
          {#if event.server_address}<span><Icon name="link" size={14} /> Entra directo al servidor</span>{/if}
          {#if event.memory}<span><Icon name="cpu" size={14} /> {formatMemory(event.memory.max_mb)}</span>{/if}
          {#if local}<span><Icon name="clock" size={14} /> {formatPlaytime(local.total_playtime_secs)} · {formatLastPlayed(local.last_played)}</span>{/if}
        </p>

        <div class="launch">
          <PlayButton id={event.id} big />
          <div class="quick">
            <button class="glass-btn" title="Registros del juego" onclick={() => (nav.logsFor = nav.logsFor === event.id ? null : event.id)}>
              <Icon name="terminal" size={17} />
            </button>
            {#if local}
              <button class="glass-btn" title="Capturas de pantalla" onclick={() => openFolder(event.id)}><Icon name="folder" size={17} /></button>
            {/if}
            <button class="glass-btn" title="Actualizar eventos" onclick={() => app.loadEvents()} disabled={app.eventsLoading}>
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </div>

        {#if app.errors[event.id]}
          <div class="alert stage-alert">
            <Icon name="alert" size={16} />
            <span>{app.errors[event.id]}</span>
            <button class="btn sm ghost" onclick={() => (nav.logsFor = event.id)}>Ver registros</button>
          </div>
        {/if}
      </div>

      {#if events.length > 1}
        <aside class="rail">
          <p class="rail-title">Tus eventos</p>
          {#each events as e (e.id)}
            {@const ebg = app.backgrounds[e.id]}
            <button class="rail-item" class:current={e.id === event.id} onclick={() => (selectedId = e.id)}>
              <span class="thumb" class:obsidia-bg={!ebg} style:background-image={ebg ? `url(${ebg})` : undefined}></span>
              <span class="rail-text">
                <span class="rail-name">{e.name}</span>
                <span class="rail-meta">{e.minecraft_version} · {loaderText(e)}</span>
              </span>
              {#if app.games[e.id]}<span class="dot live"></span>{/if}
            </button>
          {/each}
        </aside>
      {/if}
    </section>

    {#if nav.logsFor === event.id}
      <section class="logs-panel">
        <div class="section-head">
          <p class="eyebrow">Registros · {event.name}</p>
          <button class="btn ghost sm" onclick={() => (nav.logsFor = null)}><Icon name="close" size={14} /> Cerrar</button>
        </div>
        <LogView id={event.id} height="260px" />
      </section>
    {/if}
  {/if}
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 20px 24px 28px;
    min-height: 100%;
  }
  .gate {
    flex: 1;
    display: grid;
    place-items: center;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    padding: 24px;
  }
  .gate-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    max-width: 480px;
    padding: 32px;
    border-radius: var(--radius-lg);
    background: rgb(9 8 13 / 0.72);
    border: 1px solid var(--border-strong);
    box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.9);
  }
  .gate-card h1 {
    font-size: 30px;
    letter-spacing: -0.02em;
  }
  .gate-card h2 {
    font-size: 20px;
  }
  .lock {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent-hover);
  }
  .idbox {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px 10px;
    width: 100%;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px dashed var(--border-strong);
    background: rgb(255 255 255 / 0.03);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    user-select: text;
  }
  .idbox:hover {
    border-color: var(--accent);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }
  .big-cta {
    height: 52px;
    padding: 0 26px;
    font-size: 15px;
    border-radius: 0;
  }

  /* ── Escenario ── */
  .stage {
    position: relative;
    display: flex;
    align-items: stretch;
    min-height: clamp(380px, 66vh, 620px);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background-size: cover;
    background-position: center;
    overflow: hidden;
  }
  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgb(9 8 13 / 0.92) 0%, rgb(9 8 13 / 0.55) 45%, rgb(9 8 13 / 0.15) 75%, rgb(9 8 13 / 0.5) 100%),
      linear-gradient(0deg, rgb(9 8 13 / 0.85) 0%, transparent 55%);
    pointer-events: none;
  }
  .stage-main {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 14px;
    padding: clamp(22px, 4vw, 40px);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .title {
    font-size: clamp(34px, 5.2vw, 64px);
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1;
    max-width: 16ch;
    overflow-wrap: anywhere;
    text-shadow: 0 2px 30px rgb(0 0 0 / 0.5);
  }
  .desc {
    max-width: 60ch;
    color: var(--text-2);
    white-space: pre-line;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    color: var(--text-2);
    font-size: 13px;
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .launch {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 8px;
  }
  .quick {
    display: flex;
    gap: 8px;
  }
  .stage-alert {
    max-width: 640px;
    align-items: center;
  }
  .stage-alert span {
    flex: 1;
  }

  /* ── Columna lateral ── */
  .rail {
    position: relative;
    width: 270px;
    flex: none;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 6px;
    padding: 20px 18px;
    background: linear-gradient(270deg, rgb(9 8 13 / 0.78), rgb(9 8 13 / 0.35));
    border-left: 1px solid rgb(255 255 255 / 0.06);
  }
  .rail-title {
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--muted);
    margin: 6px 0 4px;
  }
  .rail-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: none;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background var(--ease), border-color var(--ease);
  }
  .rail-item:hover,
  .rail-item.current {
    background: rgb(255 255 255 / 0.06);
    border-color: var(--border);
  }
  .thumb {
    width: 54px;
    height: 38px;
    flex: none;
    border-radius: 7px;
    background-size: cover;
    background-position: center;
    border: 1px solid rgb(255 255 255 / 0.1);
  }
  .rail-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .rail-name {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rail-meta {
    font-size: 11px;
    color: var(--muted);
  }
  .logs-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  @media (max-width: 860px) {
    .rail {
      display: none;
    }
  }
</style>
