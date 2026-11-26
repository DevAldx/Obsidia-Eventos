# Obsidia Eventos 0.2.3-dev

## Cambios

La imagen de fondo de cada evento se ve en cuanto entras al launcher, sin tener que darle a Jugar, y se actualiza si el organizador la cambia.

## Detalles

- La imagen del evento se descarga al ver el evento y se guarda en el equipo; solo se vuelve a descargar si cambia.
- Al volver a la ventana del launcher se comprueban de nuevo los eventos (como mucho cada 30 s), así que los cambios hechos desde la web aparecen solos.
- Si el organizador quita la imagen, también desaparece del launcher.
- Arreglado: con un evento sin imagen, el launcher pedía el fondo una y otra vez sin parar.
- Panel web: ahora se pueden subir fotos para el fondo del evento y mods de más de 25 MB (se suben por partes).
