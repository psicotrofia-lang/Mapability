# mapability

Web para familias con un hijo o hija con discapacidad: guía de trámites y ayudas, mapa de centros de terapia, glosario de terapias y webinars. Empieza por la Comunidad de Madrid.

Se puede usar en el ordenador y en el móvil, y se puede instalar en el móvil como si fuera una app («Añadir a pantalla de inicio»).

> **Estado: prototipo.** Todo el contenido es de ejemplo y está marcado como borrador. Los centros del mapa son ficticios.

## Cómo está organizado

| Carpeta o archivo | Qué hay dentro |
| --- | --- |
| `content/` | Las fichas. Una ficha por archivo: `tramites/`, `itinerarios/`, `centros/`, `glosario/`, `webinars/` y `noticias/`. |
| `content/comunidades.json` | Las comunidades autónomas y cuáles están abiertas. |
| `.pages.yml` | La configuración del panel de edición. |
| `index.html`, `assets/` | La web en sí: diseño y funcionamiento. |
| `scripts/construir.mjs` | Junta las fichas y comprueba que no haya errores antes de publicar. |
| `.github/workflows/` | La publicación automática. |

## Editar fichas sin tocar código

Las fichas se editan desde un panel web, [Pages CMS](https://app.pagescms.org). Las instrucciones paso a paso están en [docs/como-editar.md](docs/como-editar.md).

## Datos y privacidad

La fase 1 no guarda datos de las familias. «Mi plan» y la ubicación para buscar centros cercanos se quedan en el dispositivo de cada persona. El perfilado y la comunidad (fase 2) necesitarán una auditoría de seguridad y protección de datos antes de abrirse al público.

## Para quien desarrolle

Es una web estática sin dependencias. Para verla en local:

```sh
node scripts/construir.mjs   # genera datos/ a partir de content/
python3 -m http.server 8000  # y abre http://localhost:8000
```

El mapa usa [Leaflet](https://leafletjs.com) (incluido en `assets/vendor/`) y teselas de OpenStreetMap; antes del lanzamiento conviene pasar a un proveedor de teselas con condiciones de uso para producción. El contorno de la Comunidad de Madrid procede del proyecto click_that_hood de Code for Germany.
