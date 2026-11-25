# Obsidia Eventos 0.2.0-dev

## Cambios

Llegan los rangos (Owner, Developer, Staff, Miembro e Invitado) y un panel de organizadores más seguro.

## Rangos

- **Cinco rangos**, uno por persona para todos los eventos: Owner, Developer, Staff, Miembro e Invitado.
- **Owner**: lo puede todo, incluido dar cualquier rango.
- **Developer**: crea, edita y borra eventos y mods; gestiona whitelists; da rangos hasta Staff.
- **Staff**: añade y quita jugadores de la whitelist y da Miembro o Invitado. Entra a todos los eventos.
- **Miembro e Invitado**: juegan los eventos en cuya whitelist están. Invitado es el rango por defecto.
- Al añadir a alguien a la whitelist, desde el launcher o desde el panel web, eliges su rango.
- Nueva ventana **Rangos** en la pestaña Admin y sección **Rangos** en el panel web.
- Nadie puede cambiar ni quitar de una whitelist a alguien con su rango o superior, salvo un Owner.
- Tu rango aparece en el menú de tu cuenta.
- El `whitelist.json` del servidor de Minecraft incluye también al equipo (Staff o superior).

## Seguridad del panel web

- **Bloqueo por fuerza bruta**: 5 contraseñas incorrectas en 15 minutos bloquean esa IP durante 15 minutos.
- **Salir** cierra la sesión también en el servidor.
- Nuevo botón **Cerrar todas las sesiones**. Cambiar la contraseña del panel también las cierra todas.
- La clave del servidor de Minecraft (`SERVER_KEY`) ya no se acepta en la URL, solo en la cabecera `Authorization`.
- Cabeceras de seguridad más estrictas: CSP con Trusted Types, sin iframes, HSTS y `nosniff`.

## Windows

- Instalador NSIS para Windows (solo para tu usuario, en español e inglés).
