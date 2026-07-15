# 🌿 Coral Reader — tu biblioteca viva

**Convierte tu teléfono (o cualquier navegador) en un ebook.** Una PWA de
lectura, 100 % offline, con un lector de pasa-página realista, estadísticas
enormes y **Coral**, el bibliotecario con IA que ordena tu biblioteca,
completa metadatos y busca carátulas por ti.

> La app es la interfaz. **Coral es el cerebro.** Si abres esto y piensas
> «mi biblioteca está más ordenada aquí que en mi estantería», ganamos.

Creado por **Jhonatan David Castro Galviz** · parte del ecosistema
[Coral / Nexus](https://github.com/RouceDevStudio/Nexus).

---

## ✨ Qué hace

- **Biblioteca**: cuadrícula, lista y estantería · orden por título, autor,
  fecha añadida, última apertura, tamaño, páginas, progreso, favoritos ·
  carpetas, colecciones, etiquetas, series, libros ocultos y **papelera**.
- **Formatos**: `EPUB` · `PDF` · `MOBI/AZW/AZW3` · `CBZ` · `FB2` · `TXT` ·
  `Markdown` · `HTML` · `DOCX`. *(CBR/RAR avisa y pide convertir a CBZ; los
  MOBI con DRM o compresión HUFF también se detectan con elegancia.)*
- **Importación**: archivos sueltos, **carpeta completa** (cientos de libros),
  desde una **URL**, o compartidos desde otra app (Share Target). Detecta
  **duplicados** automáticamente.
- **Explorador de archivos** propio: crear/renombrar/mover/eliminar carpetas,
  multiselección y búsqueda.
- **Lector**:
  - Temas: blanco, sepia, gris, negro y **AMOLED**.
  - Tipografía: tamaño, interlineado, márgenes, sangría, separación de
    palabras, alineación · **importar tus propias fuentes**.
  - Animación de página: **libro real (flip 3D a 60 fps)**, deslizar,
    continuo o ninguna.
  - Brillo independiente del sistema + **filtro cálido nocturno**.
  - Zonas táctiles, gestos, teclado y ratón · **modo concentración** · TTS.
  - PDF con render por página y zoom · cómics con visor vertical.
- **Notas**: subrayados a color, notas, marcadores y **exportar a Markdown**.
- **Estadísticas**: horas, racha, libros terminados/empezados, páginas/día,
  palabras/min, sesiones, **calendario tipo GitHub**, tus horas favoritas,
  **metas diarias** con anillo de progreso y exportación **CSV / PDF**.
- **Portadas**: búsqueda automática (Google Books / Open Library), cambiar
  por una imagen tuya, o **generar una** con Coral cuando no exista.
- **Coral (el bibliotecario)**: completa autor, descripción, editorial, año,
  ISBN, idioma, categoría, saga y volumen · organiza en *Leyendo, Pendientes,
  Terminados, Abandonados, Favoritos…* · te habla:
  *«Hace 12 días que no continúas este libro»*, *«Vas por el 82 %…»*.
- **PWA de verdad**: instalable, **100 % offline** (Service Worker +
  IndexedDB + **OPFS**), actualizaciones silenciosas, copias de seguridad
  (`.json` y `.zip` con tus archivos). Tus libros nunca salen del dispositivo.
- **Accesibilidad**: TTS, modo dislexia, alto contraste, teclado, lector de
  pantalla.

Sin cuentas, sin servidores, sin rastreo.

---

## 🚀 Cómo ejecutarla

Es una PWA sin build. Solo necesita servirse por HTTP(S) (el Service Worker
y OPFS requieren un origen seguro: `https://` o `http://localhost`).

```bash
# cualquiera de estas sirve
npx serve .
# o
python3 -m http.server 8080
```

Abre `http://localhost:8080` y, desde el navegador, **Instalar app**. En
Android queda como una app nativa; funciona sin conexión desde la primera
carga.

> No hay dependencias que instalar: `fflate` (EPUB/CBZ/DOCX/ZIP) y `pdf.js`
> vienen vendorizados en `js/vendor/` para que **todo funcione offline**.

---

## 🧠 Conectar con Coral (Nexus) — el cerebro

La app funciona sola con heurísticas locales + catálogos web. Pero si
conectas tu servidor **Coral (Nexus)**, el bibliotecario usa el **LLM** para
enriquecer metadatos.

1. Despliega [Nexus](https://github.com/RouceDevStudio/Nexus) (expone
   `POST /api/coral/librarian`).
2. En **Coral Reader → Ajustes → Coral**, pega la URL de tu Nexus
   (ej. `https://tu-nexus.up.railway.app`) y **Probar conexión**.
3. Usa **Coral → «Completar metadatos de todos»** y deja que ordene tu
   biblioteca.

La cadena de enriquecimiento es tolerante a fallos:
**Coral (LLM) → Google Books → Open Library → heurísticas locales**. Si estás
offline, todo sigue funcionando.

---

## 🗂️ Arquitectura

```
index.html · manifest.webmanifest · sw.js
css/styles.css
js/
  app.js            Controlador, router, tema, drawer, importación
  db.js             IndexedDB (metadatos, progreso, notas, sesiones, ajustes)
  storage.js        Blobs pesados en OPFS (fallback IndexedDB)
  models.js         Dominio: libros, carpetas, colecciones, stats
  importer.js       Importación multiformato + duplicados
  coral.js          Cliente del bibliotecario + heurísticas offline
  covers.js         Portadas: generación canvas + búsqueda online
  library.js        Vistas cuadrícula/lista/estantería + menú contextual
  reader.js         Motor de lectura (reflow/PDF/imágenes) + flip 3D
  notes.js          Subrayados, notas, marcadores, exportar
  stats.js          Estadísticas + heatmap + exportación
  search.js         Búsqueda global
  fileexplorer.js   Explorador de archivos
  settings.js       Ajustes, fuentes, copias de seguridad
  coralview.js      Panel de Coral
  parsers/          epub · pdf · mobi · cbz · fb2 · txt · markdown · html · docx
  vendor/           fflate · pdf.js (offline)
```

Los **metadatos** viven en IndexedDB; los **archivos de libro** y **portadas**
en **OPFS** (Origin Private File System) cuando está disponible, con respaldo
automático en IndexedDB.

---

## 📄 Licencia

© Jhonatan David Castro Galviz. Incluye `fflate` (MIT) y `pdf.js` (Apache-2.0)
en `js/vendor/`.
