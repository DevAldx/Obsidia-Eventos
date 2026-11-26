# Obsidia Eventos 0.2.4-dev

## Cambios

Arreglado: en Windows, Minecraft se cerraba al arrancar con «Failed to locate library: lwjgl.dll».

## Detalles

- El launcher elegía siempre las librerías gráficas de Linux (LWJGL), también en Windows. Ahora usa las del sistema en el que se ejecuta (Windows, Linux o macOS).
- Afecta a todas las versiones de Minecraft, también a las antiguas que usan natives por clasificador.
