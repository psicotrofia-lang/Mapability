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

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

async function nominatim(params) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&" + new URLSearchParams(params);
  await espera(1100);
  const res = await (await fetch(url, { headers: { "User-Agent": UA } })).json();
  if (!res[0]) return null;
  return { lat: Number(res[0].lat), lng: Number(res[0].lon) };
}

const centrosMunicipio = {};
async function centroMunicipio(m) {
  if (!(m in centrosMunicipio)) centrosMunicipio[m] = await nominatim({ city: m, state: "Comunidad de Madrid" });
  return centrosMunicipio[m];
}

async function cartociudad(q) {
  const url = "https://www.cartociudad.es/geocoder/api/geocoder/findJsonp?q=" + encodeURIComponent(q);
  const txt = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const json = JSON.parse(txt.replace(/^[^(]*\(/, "").replace(/\)\s*;?\s*$/, ""));
  const lat = Number(json.lat), lng = Number(json.lng);
  if (!isFinite(lat) || !lat) return null;
  return { lat, lng, tipo: json.type, estado: json.state };
}

async function geocodifica(c) {
  const calle = limpiaDireccion(c.direccion);
  const centro = await centroMunicipio(c.municipio);
  const radio = c.municipio === "Madrid" ? 16 : 10;
  const valido = (p) => p && dentroMadrid(p.lat, p.lng) && (!centro || km(centro, p) <= radio);
  const intentos = [
    ["CartoCiudad", "calle", () => cartociudad(`${calle}, ${c.municipio}`)],
    ["CartoCiudad", "calle", () => cartociudad(`${calle}, ${c.cp} ${c.municipio}`)],
    ["OpenStreetMap", "calle", () => nominatim({ street: calle.replace(/^(.*?),?\s*(\d+\w*)\b.*$/, "$2 $1"), city: c.municipio, postalcode: c.cp })],
    ["OpenStreetMap", "código postal", () => nominatim({ postalcode: c.cp, country: "es" })],
  ];
  for (const [fuente, precision, f] of intentos) {
    try {
      const p = await f();
      if (valido(p)) return { lat: p.lat, lng: p.lng, fuente, precision };
    } catch (e) {
      console.warn("Fallo", fuente, c.nombre, e.message);
    }
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

const overpass = `[out:json][timeout:90];
(
  nwr["healthcare"~"^(speech_therapist|occupational_therapist)$"](40.31,-3.89,40.64,-3.52);
  nwr["healthcare:speciality"~"speech|occupational|paediatric|early_intervention|logoped",i](40.31,-3.89,40.64,-3.52);
  nwr["healthcare"~"^(physiotherapist|psychotherapist|psychologist|counselling|centre|clinic)$"]["name"~"infantil|pedi[aá]tric|ni[ñn]|neuro|logoped|temprana|desarrollo|autis|TEA|down|par[aá]lisis",i](40.31,-3.89,40.64,-3.52);
  nwr["amenity"="social_facility"]["social_facility:for"~"disabled|child|mental_health"](40.31,-3.89,40.64,-3.52);
  nwr["office"~"association|ngo|foundation"]["name"~"discapac|autis|down|par[aá]lisis|sordo|ciego|TEA|asperger",i](40.31,-3.89,40.64,-3.52);
  nwr["leisure"~"sports_centre|pitch"]["name"~"adaptad|inclusiv",i](40.31,-3.89,40.64,-3.52);
);
out center tags;`;
let osm = [];
try {
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(overpass),
  });
  const txt = await r.text();
  console.log("Overpass", r.status, txt.slice(0, 300));
  const j = JSON.parse(txt);
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
