// mapability · prepara los datos de la web
// Junta las fichas sueltas de content/ (una por archivo, como las guarda el panel de edición)
// en un archivo por tipo dentro de datos/, que es lo que lee la web.
// Uso: node scripts/construir.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const CONTENIDO = join(RAIZ, "content");
const SALIDA = join(RAIZ, "datos");
const TIPOS = ["tramites", "itinerarios", "centros", "glosario", "webinars", "noticias"];

const errores = [];
const avisos = [];

// El panel guarda los enlaces entre fichas como la ruta del archivo
// ("content/tramites/certificado-discapacidad.json"); la web solo necesita el nombre.
const aId = (valor) => basename(String(valor || "")).replace(/\.json$/, "");

function leerJson(ruta) {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch (e) {
    errores.push(`No se puede leer ${ruta.replace(RAIZ, "")}: ${e.message}`);
    return null;
  }
}

function leerCarpeta(tipo) {
  const carpeta = join(CONTENIDO, tipo);
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const ficha = leerJson(join(carpeta, f));
      return ficha ? { ...ficha, id: f.replace(/\.json$/, "") } : null;
    })
    .filter(Boolean);
}

const datos = Object.fromEntries(TIPOS.map((t) => [t, leerCarpeta(t)]));
datos.comunidades = leerJson(join(CONTENIDO, "comunidades.json")) || [];

const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []);
for (const t of datos.tramites) {
  t.relacionados = lista(t.relacionados).map(aId);
  t.requiere = lista(t.requiere).map(aId);
  t.espera_semanas = Number(t.espera_semanas) || 0;
  t.terapias = lista(t.terapias).map(aId);
  t.documentos = lista(t.documentos).filter(Boolean);
}
for (const c of datos.centros) {
  c.terapias = lista(c.terapias).map(aId);
  c.idiomas = lista(c.idiomas);
  c.lat = Number(c.lat);
  c.lng = Number(c.lng);
  c.edad_min = Number(c.edad_min || 0);
  c.edad_max = Number(c.edad_max || 99);
  if (!isFinite(c.lat) || !isFinite(c.lng) || !c.lat || !c.lng) {
    avisos.push(`El centro "${c.nombre}" no tiene coordenadas y no saldrá en el mapa.`);
  }
}
for (const w of datos.webinars) w.tramites = lista(w.tramites).map(aId);
for (const it of datos.itinerarios) {
  it.pasos = lista(it.pasos).map((p) => ({ ...p, tramite: aId(p.tramite) }));
}
datos.noticias.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
datos.itinerarios.sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

// Avisa de enlaces a fichas que ya no existen.
const ids = (tipo) => new Set(datos[tipo].map((x) => x.id));
const tramites = ids("tramites");
const glosario = ids("glosario");
const comprobar = (origen, valores, conjunto, tipo) => {
  for (const v of valores) if (!conjunto.has(v)) avisos.push(`${origen} enlaza a "${v}", que no está en ${tipo}.`);
};
datos.tramites.forEach((t) => {
  comprobar(`El trámite "${t.titulo}"`, t.relacionados, tramites, "trámites");
  comprobar(`El trámite "${t.titulo}"`, t.terapias, glosario, "el glosario");
  comprobar(`El trámite "${t.titulo}"`, t.requiere, tramites, "trámites");
});
datos.centros.forEach((c) => comprobar(`El centro "${c.nombre}"`, c.terapias, glosario, "el glosario"));
datos.itinerarios.forEach((it) => comprobar(`El itinerario "${it.titulo}"`, it.pasos.map((p) => p.tramite), tramites, "trámites"));

// Un trámite no puede depender de sí mismo, ni directa ni indirectamente.
const porIdTramite = Object.fromEntries(datos.tramites.map((t) => [t.id, t]));
function enCiclo(id, visto = new Set()) {
  if (visto.has(id)) return true;
  visto.add(id);
  return (porIdTramite[id]?.requiere || []).some((r) => enCiclo(r, new Set(visto)));
}
datos.tramites.forEach((t) => {
  if (enCiclo(t.id)) errores.push(`El trámite "${t.titulo}" acaba dependiendo de sí mismo en «Hay que tener antes». Revisa esos campos.`);
});

avisos.forEach((a) => console.warn("Aviso: " + a));
if (errores.length) {
  errores.forEach((e) => console.error("Error: " + e));
  process.exit(1);
}

mkdirSync(SALIDA, { recursive: true });
for (const [tipo, items] of Object.entries(datos)) {
  writeFileSync(join(SALIDA, tipo + ".json"), JSON.stringify(items));
}
console.log("Datos preparados: " + Object.entries(datos).map(([t, i]) => `${i.length} ${t}`).join(", "));
