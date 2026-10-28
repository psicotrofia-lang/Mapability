// Prepara la lista de centros candidatos (se ejecuta en GitHub Actions, que tiene acceso a internet).
// 1) Sitúa en el mapa los centros de la red pública de atención temprana (atencion-temprana.tsv)
//    con el geocodificador público CartoCiudad y, si falla, con Nominatim (OpenStreetMap).
// 2) Busca en OpenStreetMap otros centros de Madrid capital relacionados con terapias infantiles.
// Resultado: salida.json
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "mapability/0.1 (https://github.com/psicotrofia-lang/Mapability)";
const dentroMadrid = (lat, lng) => lat > 39.85 && lat < 41.2 && lng > -4.6 && lng < -3.0;

function limpiaDireccion(d) {
  return d.replace(/^C\/\s*/i, "Calle ").replace(/,\s*(bajo|local|loc\.).*$/i, "").replace(/\s+/g, " ").trim();
}

async function cartociudad(q) {
  const url = "https://www.cartociudad.es/geocoder/api/geocoder/findJsonp?q=" + encodeURIComponent(q);
  const txt = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const json = JSON.parse(txt.replace(/^[^(]*\(/, "").replace(/\)\s*;?\s*$/, ""));
  const lat = Number(json.lat), lng = Number(json.lng);
  if (!dentroMadrid(lat, lng)) return null;
  return { lat, lng, precision: json.state === 1 ? "portal" : "calle", fuente: "CartoCiudad" };
}

async function nominatim(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=" + encodeURIComponent(q);
  const res = await (await fetch(url, { headers: { "User-Agent": UA } })).json();
  if (!res[0]) return null;
  const lat = Number(res[0].lat), lng = Number(res[0].lon);
  if (!dentroMadrid(lat, lng)) return null;
  return { lat, lng, precision: "aproximada", fuente: "Nominatim" };
}

async function geocodifica(c) {
  const dir = limpiaDireccion(c.direccion);
  const q = `${dir}, ${c.cp} ${c.municipio}`;
  for (const f of [cartociudad, nominatim]) {
    try {
      const r = await f(q);
      if (r) return r;
    } catch (e) {
      console.warn("Fallo", f.name, q, e.message);
    }
    await espera(1100);
  }
  return null;
}

const filas = readFileSync(dir + "atencion-temprana.tsv", "utf8").trim().split("\n");
const cab = filas.shift().split("\t");
const at = filas.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cab[i], v])));

for (const c of at) {
  c.geo = await geocodifica(c);
  console.log((c.geo ? "OK  " : "NO  ") + c.nombre, c.geo ? `${c.geo.lat},${c.geo.lng} (${c.geo.fuente}, ${c.geo.precision})` : "");
  await espera(300);
}

const overpass = `[out:json][timeout:120];
area["name"="Madrid"]["admin_level"="8"]["boundary"="administrative"]->.m;
(
  nwr["healthcare"~"^(speech_therapist|occupational_therapist)$"](area.m);
  nwr["healthcare:speciality"~"speech|occupational|paediatric|early_intervention|logoped",i](area.m);
  nwr["healthcare"~"^(physiotherapist|psychotherapist|psychologist|counselling|centre|clinic)$"]["name"~"infantil|pedi[aá]tric|ni[ñn]|neuro|logoped|temprana|desarrollo|autis|TEA|down|par[aá]lisis",i](area.m);
  nwr["amenity"="social_facility"]["social_facility:for"~"disabled|child|mental_health"](area.m);
  nwr["office"~"association|ngo|foundation"]["name"~"discapac|autis|down|par[aá]lisis|sordo|ciego|TEA|asperger",i](area.m);
  nwr["leisure"~"sports_centre|pitch"]["name"~"adaptad|inclusiv",i](area.m);
);
out center tags;`;
let osm = [];
try {
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(overpass),
  });
  const j = await r.json();
  osm = j.elements.map((e) => ({
    osm: `${e.type}/${e.id}`,
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
    tags: e.tags || {},
  })).filter((e) => e.tags.name);
  console.log("OpenStreetMap:", osm.length, "elementos con nombre");
} catch (e) {
  console.warn("Fallo Overpass", e.message);
}

writeFileSync(dir + "salida.json", JSON.stringify({ generado: new Date().toISOString(), atencion_temprana: at, osm }, null, 1));
