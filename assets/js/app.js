/* mapability · aplicación
   Web estática: lee las fichas de la carpeta content/ y pinta cada sección
   según la dirección (#guia, #mapa, #tramite-certificado-discapacidad…). */
(function () {
  "use strict";

  var ARCHIVOS = ["comunidades", "tramites", "itinerarios", "centros", "glosario", "webinars", "noticias"];
  var CLAVE_PLAN = "mapability.plan";

  var datos = {};
  var main = document.getElementById("contenido");
  var mapa = null;

  var filtros = { texto: "", terapia: "", edad: "", financiacion: { publico: true, concertado: true, privado: true }, accesible: false, atencionTemprana: false };
  var miPosicion = null;

  var AMBITOS = { estatal: "Estatal", autonomico: "Comunidad", municipal: "Municipio" };
  var FINANCIACION = { publico: "Público", concertado: "Concertado", privado: "Privado" };
  var TIPOS_GLOSARIO = { terapia: "Terapias", deporte: "Deporte y ocio", termino: "Palabras de los trámites" };
  var CATEGORIAS = { ayudas: "Ayudas y trámites", investigacion: "Investigación", politica: "Política", terapias: "Terapias", educacion: "Educación", ocio: "Ocio y deporte", familias: "Familias", mapability: "Novedades de mapability" };
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  /* ---------- utilidades ---------- */

  function esc(valor) {
    return String(valor == null ? "" : valor)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function enlaceSeguro(url) {
    return /^https?:\/\//i.test(url || "") ? url : "";
  }

  function normalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function porId(lista, id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }

  function fechaLarga(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return parseInt(p[2], 10) + " " + MESES[parseInt(p[1], 10) - 1] + " " + p[0];
  }

  function distanciaKm(a, b) {
    var r = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * r * Math.asin(Math.sqrt(h));
  }

  function chipBorrador(item) {
    return item && item.borrador ? '<span class="chip chip--borrador">Borrador</span>' : "";
  }

  /* ---------- Mi plan (se guarda solo en este dispositivo) ---------- */

  function leerPlan() {
    try { return JSON.parse(localStorage.getItem(CLAVE_PLAN)) || {}; } catch (e) { return {}; }
  }
  function guardarPlan(plan) {
    try { localStorage.setItem(CLAVE_PLAN, JSON.stringify(plan)); } catch (e) { /* sin almacenamiento */ }
  }
  function estadoEnPlan(id) { return leerPlan()[id] || ""; }
  function cambiarEstado(id, estado) {
    var plan = leerPlan();
    if (estado) plan[id] = estado; else delete plan[id];
    guardarPlan(plan);
  }

  var ESTADOS = { pendiente: "Por hacer", esperando: "Pedido, esperando respuesta", hecho: "Resuelto" };

  function chipEstado(estado) {
    if (!estado) return "";
    return '<span class="chip' + (estado === "hecho" ? " chip--hecho" : estado === "esperando" ? " chip--espera" : "") + '">' + ESTADOS[estado] + "</span>";
  }

  function botonPlan(id, estado, texto, claro) {
    return '<button class="boton boton--peque' + (claro ? " boton--claro" : "") + '" data-plan="' + esc(id) + '" data-estado="' + estado + '">' + texto + "</button>";
  }

  function botonesPlan(id) {
    var estado = estadoEnPlan(id);
    if (estado === "hecho") return chipEstado(estado) + botonPlan(id, "esperando", "Deshacer", true);
    if (estado === "esperando") return chipEstado(estado) + botonPlan(id, "hecho", "Ya está resuelto");
    if (estado === "pendiente") return chipEstado(estado) + botonPlan(id, "esperando", "Ya lo he pedido") + botonPlan(id, "", "Quitar", true);
    return botonPlan(id, "pendiente", "Añadir a mi plan", true);
  }

  function duracion(semanas) {
    if (semanas <= 1) return "menos de una semana";
    if (semanas < 9) return "unas " + Math.round(semanas) + " semanas";
    var meses = Math.round(semanas / 4.33);
    return meses === 1 ? "alrededor de un mes" : "unos " + meses + " meses";
  }

  /* Ordena el plan: qué se puede pedir ya (lo más lento primero, para aprovechar la espera),
     qué está en marcha y qué depende de otro trámite. La estimación es orientativa. */
  function ordenarPlan() {
    var plan = leerPlan();
    var fin = {};
    function finDe(id, camino) {
      if (id in fin) return fin[id];
      var t = porId(datos.tramites, id);
      if (!t || plan[id] === "hecho" || camino.indexOf(id) !== -1) return (fin[id] = 0);
      var inicio = 0;
      (t.requiere || []).forEach(function (r) { inicio = Math.max(inicio, finDe(r, camino.concat(id))); });
      return (fin[id] = inicio + (t.espera_semanas || 0));
    }
    var grupos = { ahora: [], esperando: [], despues: [], hechos: [] };
    Object.keys(plan).forEach(function (id) {
      var t = porId(datos.tramites, id);
      if (!t) return;
      var falta = (t.requiere || []).filter(function (r) { return plan[r] !== "hecho"; });
      var item = { t: t, falta: falta, fin: finDe(id, []) };
      if (plan[id] === "hecho") grupos.hechos.push(item);
      else if (plan[id] === "esperando") grupos.esperando.push(item);
      else if (falta.length) grupos.despues.push(item);
      else grupos.ahora.push(item);
    });
    grupos.ahora.sort(function (a, b) { return (b.t.espera_semanas || 0) - (a.t.espera_semanas || 0); });
    grupos.esperando.sort(function (a, b) { return a.fin - b.fin; });
    grupos.despues.sort(function (a, b) { return a.fin - b.fin; });
    grupos.total = Object.keys(plan).reduce(function (m, id) { return Math.max(m, plan[id] === "hecho" ? 0 : finDe(id, [])); }, 0);
    return grupos;
  }

  /* ---------- carga de datos ---------- */

  function cargar() {
    if (window.MAPABILITY_DATA) return Promise.resolve(window.MAPABILITY_DATA);
    return Promise.all(ARCHIVOS.map(function (nombre) {
      return fetch("datos/" + nombre + ".json", { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error(nombre);
        return r.json();
      });
    })).then(function (listas) {
      var d = {};
      ARCHIVOS.forEach(function (nombre, i) { d[nombre] = listas[i]; });
      var madrid = porId(d.comunidades, "madrid");
      if (madrid && madrid.limite) {
        return fetch(madrid.limite).then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (geo) { d.limites = { madrid: geo }; return d; });
      }
      return d;
    });
  }

  /* ---------- vistas ---------- */

  function vistaInicio() {
    var rutas = datos.itinerarios.map(function (it) {
      return '<a class="ruta" href="#itinerario-' + esc(it.id) + '">' +
        '<span class="ruta__titulo">' + esc(it.titulo) + '</span>' +
        '<span class="ruta__texto">' + esc(it.subtitulo) + '</span>' +
        '<span class="ruta__pie">' + it.pasos.length + ' pasos →</span></a>';
    }).join("");

    return '<section class="portada">' +
      '<p class="etiqueta lema">Orienta <i aria-hidden="true"></i> Conecta <i aria-hidden="true"></i> Acompaña</p>' +
      '<h1>Os acompañamos en el camino, <span>paso a paso</span>.</h1>' +
      '<p class="entradilla">Qué trámites y ayudas os corresponden, en qué orden pedirlos, qué terapias existen y dónde están los centros más cercanos. Sin registrarse y gratis.</p>' +
      '</section>' +
      '<section class="seccion" aria-labelledby="t-rutas">' +
      '<h2 id="t-rutas">¿En qué momento estáis?</h2>' +
      '<div class="rutas">' + rutas + '</div></section>' +
      '<section class="seccion" aria-labelledby="t-atajos">' +
      '<h2 id="t-atajos">También puedes</h2>' +
      '<div class="atajos">' +
      '<a class="atajo" href="#mapa"><strong>Buscar centros cerca</strong><span>' + datos.centros.length + ' centros en el mapa</span></a>' +
      '<a class="atajo" href="#glosario"><strong>Entender una terapia</strong><span>Logopedia, fisioterapia, deporte adaptado…</span></a>' +
      '<a class="atajo" href="#guia"><strong>Ver todos los trámites</strong><span>' + datos.tramites.length + ' fichas de ayudas y trámites</span></a>' +
      '<a class="atajo" href="#formacion"><strong>Apuntarte a un webinar</strong><span>Formación gratuita para familias</span></a>' +
      '</div></section>' +
      ((datos.noticias || []).length ? '<section class="seccion" aria-labelledby="t-noticias"><div class="seccion__cabecera"><h2 id="t-noticias">Últimas noticias</h2><a href="#noticias">Ver todas</a></div>' +
        '<div class="noticias">' + datos.noticias.slice(0, 3).map(tarjetaNoticia).join("") + "</div></section>" : "");
  }

  function filaTramite(t) {
    var estado = estadoEnPlan(t.id);
    return '<li><a class="fila" href="#tramite-' + esc(t.id) + '">' +
      '<span class="fila__titulo">' + esc(t.titulo) + '</span>' +
      '<span class="fila__texto">' + esc(t.resumen) + '</span>' +
      '<span class="fila__extra">' +
      chipEstado(estado) +
      '<span class="chip chip--ambito">' + esc(AMBITOS[t.ambito] || t.ambito) + '</span></span>' +
      '</a></li>';
  }

  function vistaGuia() {
    var rutas = datos.itinerarios.map(function (it) {
      return '<a class="ruta" href="#itinerario-' + esc(it.id) + '">' +
        '<span class="ruta__titulo">' + esc(it.titulo) + '</span>' +
        '<span class="ruta__texto">' + esc(it.subtitulo) + '</span>' +
        '<span class="ruta__pie">' + it.pasos.length + ' pasos →</span></a>';
    }).join("");

    return '<section class="lectura">' +
      '<p class="etiqueta">Guía de trabajo social</p>' +
      '<h1>Trámites y ayudas</h1>' +
      '<p class="entradilla">Empieza por la situación que más se parece a la vuestra, o busca un trámite concreto.</p>' +
      '</section>' +
      '<section class="seccion" aria-labelledby="t-itin"><h2 id="t-itin">Itinerarios</h2><div class="rutas">' + rutas + '</div></section>' +
      '<section class="seccion" aria-labelledby="t-todos">' +
      '<div class="seccion__cabecera"><h2 id="t-todos">Todas las fichas</h2><a href="#mi-plan">Ver mi plan</a></div>' +
      '<label class="campo"><span class="etiqueta">Buscar un trámite</span>' +
      '<input id="buscar-tramite" class="buscador" type="text" placeholder="Por ejemplo: dependencia, renta, colegio" autocomplete="off"></label>' +
      '<ul class="lista" id="lista-tramites">' + datos.tramites.map(filaTramite).join("") + '</ul>' +
      '<p class="vacio" id="sin-tramites" hidden>No hay ninguna ficha con esas palabras. Prueba con otra palabra.</p>' +
      '</section>';
  }

  function activarGuia() {
    var campo = document.getElementById("buscar-tramite");
    campo.addEventListener("input", function () {
      var q = normalizar(campo.value.trim());
      var lista = datos.tramites.filter(function (t) {
        return !q || normalizar(t.titulo + " " + t.resumen + " " + t.que_es).indexOf(q) !== -1;
      });
      document.getElementById("lista-tramites").innerHTML = lista.map(filaTramite).join("");
      document.getElementById("sin-tramites").hidden = lista.length > 0;
    });
  }

  function vistaItinerario(id) {
    var it = porId(datos.itinerarios, id);
    if (!it) return vistaNoEncontrada();
    var pasos = it.pasos.map(function (p) {
      var t = porId(datos.tramites, p.tramite);
      if (!t) return "";
      var hecho = estadoEnPlan(t.id) === "hecho";
      return '<li class="paso' + (hecho ? " es-hecho" : "") + '">' +
        '<a class="paso__titulo" href="#tramite-' + esc(t.id) + '">' + esc(t.titulo) + '</a>' +
        '<p class="paso__nota">' + esc(p.nota) + '</p>' +
        '<div class="paso__acciones">' + botonesPlan(t.id) + '</div></li>';
    }).join("");
    return '<p class="miga"><a href="#guia">Guía</a></p>' +
      '<section class="lectura"><p class="etiqueta">Itinerario ' + chipBorrador(it) + '</p>' +
      '<h1>' + esc(it.titulo) + '</h1>' +
      '<p class="entradilla">' + esc(it.intro) + '</p>' +
      '<div class="paso__acciones"><button class="boton boton--peque" data-plan-todos="' + esc(it.id) + '">Añadir todos a mi plan</button><a href="#mi-plan">Ver mi plan ordenado</a></div></section>' +
      '<ol class="pasos">' + pasos + '</ol>' +
      '<p class="mapa-nota">Lo que marques se guarda solo en este dispositivo. mapability no recibe esos datos.</p>';
  }

  function bloque(titulo, contenido) {
    if (!contenido) return '<div class="ficha__bloque"><h2>' + esc(titulo) + '</h2><p class="pendiente">Pendiente de redactar.</p></div>';
    return '<div class="ficha__bloque"><h2>' + esc(titulo) + '</h2>' + contenido + '</div>';
  }
  function parrafo(texto) { return texto ? "<p>" + esc(texto) + "</p>" : ""; }

  function vistaTramite(id) {
    var t = porId(datos.tramites, id);
    if (!t) return vistaNoEncontrada();
    var docs = (t.documentos || []).length ? "<ul>" + t.documentos.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : "";
    var relacionados = (t.relacionados || []).map(function (rid) {
      var r = porId(datos.tramites, rid);
      return r ? '<li><a href="#tramite-' + esc(r.id) + '">' + esc(r.titulo) + "</a></li>" : "";
    }).join("");
    var terapias = (t.terapias || []).map(function (tid) {
      var g = porId(datos.glosario, tid);
      return g ? '<a class="chip" href="#glosario-' + esc(g.id) + '">' + esc(g.nombre) + "</a>" : "";
    }).join("");
    var url = enlaceSeguro(t.enlace_oficial);

    return '<p class="miga"><a href="#guia">Guía</a></p>' +
      '<section class="lectura"><div class="chips"><span class="chip chip--ambito">' + esc(AMBITOS[t.ambito] || t.ambito) + '</span>' + chipBorrador(t) + '</div>' +
      '<h1>' + esc(t.titulo) + '</h1><p class="entradilla">' + esc(t.resumen) + '</p>' +
      '<div class="paso__acciones">' + botonesPlan(t.id) + '</div></section>' +
      '<div class="ficha"><div class="ficha__cuerpo">' +
      bloque("Qué es", parrafo(t.que_es)) +
      bloque("Quién puede pedirlo", parrafo(t.quien_puede)) +
      bloque("Qué documentos necesitas", docs) +
      bloque("Dónde se pide", parrafo(t.donde)) +
      bloque("Plazos", parrafo(t.plazos)) +
      (terapias ? bloque("Terapias relacionadas", '<div class="chips">' + terapias + "</div>") : "") +
      '</div><aside class="ficha__lateral" aria-label="Datos de la ficha"><dl class="datos">' +
      (t.espera_semanas ? '<div class="dato"><dt>Tiempo de respuesta habitual</dt><dd>' + esc(duracion(t.espera_semanas)) + "</dd></div>" : "") +
      ((t.requiere || []).length ? '<div class="dato"><dt>Hay que tener antes</dt><dd>' + t.requiere.map(function (rid) {
        var r = porId(datos.tramites, rid);
        return r ? '<a href="#tramite-' + esc(r.id) + '">' + esc(r.titulo) + "</a>" : "";
      }).join("<br>") + "</dd></div>" : "") +
      '<div class="dato"><dt>Web oficial</dt><dd>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(t.enlace_texto || url) + "</a>" : '<span class="pendiente">Pendiente</span>') + "</dd></div>" +
      '<div class="dato"><dt>Fuente</dt><dd>' + esc(t.fuente || "Pendiente") + "</dd></div>" +
      '<div class="dato"><dt>Última revisión</dt><dd>' + (t.revisado ? esc(fechaLarga(t.revisado)) : '<span class="pendiente">Sin revisar</span>') + "</dd></div>" +
      "</dl>" + (relacionados ? '<div class="dato"><p class="etiqueta">Relacionados</p><ul class="lista-simple">' + relacionados + "</ul></div>" : "") +
      "</aside></div>";
  }

  function vistaMiPlan() {
    var g = ordenarPlan();
    var plan = leerPlan();
    var hay = g.ahora.length + g.esperando.length + g.despues.length + g.hechos.length;

    function tarjeta(item, nota, bloqueado) {
      var t = item.t;
      return '<li class="plan-item"><div class="plan-item__cuerpo">' +
        '<a class="plan-item__titulo" href="#tramite-' + esc(t.id) + '">' + esc(t.titulo) + "</a>" +
        (nota ? '<p class="plan-item__nota">' + nota + "</p>" : "") +
        '</div><div class="paso__acciones">' + (bloqueado ? chipEstado("pendiente") + botonPlan(t.id, "", "Quitar", true) : botonesPlan(t.id)) + "</div></li>";
    }
    function nombre(id) { var t = porId(datos.tramites, id); return t ? t.titulo : id; }

    var ahora = g.ahora.map(function (item, i) {
      var s = item.t.espera_semanas || 0;
      var nota = s ? "Suele tardar " + esc(duracion(s)) + " en resolverse." : "Se resuelve enseguida.";
      if (i === 0 && g.ahora.length > 1 && s) nota += " <strong>Empieza por este:</strong> es el que más tarda.";
      else if (i > 0) nota += " Puedes moverlo mientras esperas los anteriores.";
      return tarjeta(item, nota);
    }).join("");

    var esperando = g.esperando.map(function (item) {
      var s = item.t.espera_semanas || 0;
      return tarjeta(item, s ? "Respuesta habitual en " + esc(duracion(s)) + "." : "");
    }).join("");

    var despues = g.despues.map(function (item) {
      var nota = "Necesitas antes: " + item.falta.map(function (r) {
        var dentro = plan[r];
        return '<a href="#tramite-' + esc(r) + '">' + esc(nombre(r)) + "</a>" + (dentro ? "" : ' <button class="enlace-boton" data-plan="' + esc(r) + '" data-estado="pendiente">(añadir a mi plan)</button>');
      }).join(", ") + ".";
      return tarjeta(item, nota, true);
    }).join("");

    var hechos = g.hechos.map(function (item) { return tarjeta(item, ""); }).join("");

    function bloquePlan(num, titulo, texto, items) {
      return '<section class="plan-etapa"><div class="plan-etapa__cabecera"><span class="plan-etapa__num" aria-hidden="true">' + num + "</span><div><h2>" + titulo + "</h2>" +
        (texto ? '<p class="plan-etapa__texto">' + texto + "</p>" : "") + '</div></div><ul class="plan-lista">' + items + "</ul></section>";
    }

    var n = 0;
    return '<section class="lectura"><p class="etiqueta">Guía</p><h1>Mi plan</h1>' +
      '<p class="entradilla">Tus trámites, en el orden que más os conviene: primero lo que tarda más, y mientras esperáis, lo demás. Se guarda solo en este dispositivo.</p>' +
      (g.total ? '<p class="plan-resumen">' + (g.esperando.length || g.hechos.length ? "Con lo que os queda" : "Si empezáis hoy") + ', todo podría estar resuelto en <strong>' + esc(duracion(g.total)) + "</strong>. Es una estimación orientativa: los plazos reales cambian.</p>" : "") +
      "</section>" +
      (hay ? "" : '<p class="vacio">Todavía no has añadido ningún trámite. Abre un <a href="#guia">itinerario</a> y pulsa «Añadir todos a mi plan».</p>') +
      (g.ahora.length ? bloquePlan(++n, "Podéis pedirlo ya", "Empezad por lo que más tarda: así la espera corre mientras avanzáis con lo demás.", ahora) : "") +
      (g.esperando.length ? bloquePlan(++n, "En marcha", "Ya lo habéis pedido. Os avisamos de lo que suele tardar.", esperando) : "") +
      (g.despues.length ? bloquePlan(++n, "Cuando tengáis lo anterior", "Estos trámites necesitan que otro esté resuelto primero.", despues) : "") +
      (g.hechos.length ? bloquePlan("✓", "Resueltos", "", hechos) : "");
  }

  /* ---------- mapa ---------- */

  function opcionesTerapia() {
    return datos.glosario.filter(function (g) { return g.tipo !== "termino"; }).map(function (g) {
      return '<option value="' + esc(g.id) + '"' + (filtros.terapia === g.id ? " selected" : "") + ">" + esc(g.nombre) + "</option>";
    }).join("");
  }

  function vistaMapa(terapiaInicial) {
    if (terapiaInicial) filtros.terapia = terapiaInicial;
    var casillasFin = Object.keys(FINANCIACION).map(function (k) {
      return '<label class="casilla"><input type="checkbox" id="f-fin-' + k + '" data-fin="' + k + '"' + (filtros.financiacion[k] ? " checked" : "") + "> " + FINANCIACION[k] + "</label>";
    }).join("");

    return '<section class="lectura"><p class="etiqueta">Mapa de centros</p><h1>Centros cerca de ti</h1>' +
      '<p class="entradilla">Busca por municipio o código postal y filtra por terapia y edad.</p></section>' +
      '<div class="mapa-vista">' +
      '<div class="seccion">' +
      '<form class="filtros" id="filtros" aria-label="Filtros del mapa">' +
      '<div class="fila-campos"><label class="campo"><span>Municipio o código postal</span><input type="text" id="f-texto" value="' + esc(filtros.texto) + '" placeholder="Getafe, 28030…" autocomplete="off"></label>' +
      '<button type="button" class="boton boton--claro" id="cerca">Cerca de mí</button></div>' +
      '<label class="campo"><span>Terapia</span><select id="f-terapia"><option value="">Todas</option>' + opcionesTerapia() + "</select></label>" +
      '<label class="campo"><span>Edad de tu hijo o hija</span><input type="number" id="f-edad" min="0" max="99" inputmode="numeric" value="' + esc(filtros.edad) + '" placeholder="Años"></label>' +
      '<fieldset><legend>Tipo de centro</legend>' + casillasFin + "</fieldset>" +
      '<fieldset><legend>Otros</legend>' +
      '<label class="casilla"><input type="checkbox" id="f-accesible"' + (filtros.accesible ? " checked" : "") + "> Accesible en silla de ruedas</label>" +
      '<label class="casilla"><input type="checkbox" id="f-at"' + (filtros.atencionTemprana ? " checked" : "") + "> Red pública de atención temprana</label>" +
      "</fieldset></form>" +
      '<p class="resultado-cuenta" id="cuenta" aria-live="polite"></p>' +
      '<p class="mapa-nota" id="aviso-ubicacion" hidden></p>' +
      '<ul class="lista" id="lista-centros"></ul>' +
      "</div>" +
      '<div class="mapa-vista__mapa"><div id="mapa-lienzo" role="region" aria-label="Mapa de centros"></div>' +
      '<div class="leyenda"><span><i></i> Concertado o privado</span><span><i class="publico"></i> Público</span></div>' +
      '<p class="mapa-nota">Centros sacados de fuentes públicas, todavía sin comprobar con cada centro. Los de deporte y ocio son ejemplos ficticios.' +
      (window.MAPABILITY_DATA ? " En esta vista previa el mapa no muestra calles; en la web publicada sí." : "") + "</p></div>" +
      "</div>";
  }

  function centrosFiltrados() {
    var q = normalizar(filtros.texto.trim());
    var edad = filtros.edad === "" ? null : Number(filtros.edad);
    var lista = datos.centros.filter(function (c) {
      if (filtros.terapia && (c.terapias || []).indexOf(filtros.terapia) === -1) return false;
      if (edad !== null && !isNaN(edad) && (edad < c.edad_min || edad > c.edad_max)) return false;
      if (!filtros.financiacion[c.financiacion]) return false;
      if (filtros.accesible && !c.accesible) return false;
      if (filtros.atencionTemprana && !c.red_atencion_temprana) return false;
      if (q && normalizar([c.nombre, c.municipio, c.distrito, c.cp].join(" ")).indexOf(q) === -1) return false;
      return true;
    });
    if (miPosicion) {
      lista.forEach(function (c) { c._km = distanciaKm(miPosicion, c); });
      lista.sort(function (a, b) { return a._km - b._km; });
    } else {
      lista.sort(function (a, b) { return (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0) || a.municipio.localeCompare(b.municipio, "es"); });
    }
    return lista;
  }

  function nombresTerapias(c) {
    return (c.terapias || []).map(function (id) {
      var g = porId(datos.glosario, id);
      return g ? g.nombre : id;
    });
  }

  var capaCentros = null;
  var capaYo = null;

  function pintarCentros() {
    var lista = centrosFiltrados();
    document.getElementById("cuenta").textContent = lista.length === 1 ? "1 centro" : lista.length + " centros";
    document.getElementById("lista-centros").innerHTML = lista.length ? lista.map(function (c) {
      return '<li><a class="fila" href="#centro-' + esc(c.id) + '">' +
        '<span class="fila__titulo">' + esc(c.nombre) + "</span>" +
        '<span class="fila__texto">' + esc(c.municipio + (c.distrito ? " · " + c.distrito : "")) + " · " + esc(nombresTerapias(c).join(", ")) + "</span>" +
        '<span class="fila__extra">' + (c._km != null && miPosicion ? '<span class="chip">' + c._km.toFixed(1).replace(".", ",") + " km</span>" : "") +
        '<span class="chip">' + esc(FINANCIACION[c.financiacion] || c.financiacion) + "</span></span></a></li>";
    }).join("") : '<li class="vacio">No hay centros con estos filtros. Prueba a quitar alguno.</li>';

    if (!mapa || !window.L) return;
    capaCentros.clearLayers();
    lista.forEach(function (c) {
      var icono = L.divIcon({ className: "", html: '<div class="pin' + (c.financiacion === "publico" ? " pin--publico" : "") + '"></div>', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });
      L.marker([c.lat, c.lng], { icon: icono, title: c.nombre, alt: c.nombre })
        .bindPopup("<strong>" + esc(c.nombre) + "</strong>" + esc(c.municipio) + "<br>" + esc(nombresTerapias(c).join(", ")) +
          '<br><a href="#centro-' + esc(c.id) + '">Ver ficha</a>')
        .addTo(capaCentros);
    });
  }

  function iniciarMapa() {
    var lienzo = document.getElementById("mapa-lienzo");
    if (!window.L) {
      lienzo.innerHTML = '<p class="vacio">No se ha podido cargar el mapa. La lista de centros sigue disponible.</p>';
      return;
    }
    var com = porId(datos.comunidades, "madrid");
    mapa = L.map(lienzo, { scrollWheelZoom: false }).setView([com.centro_lat, com.centro_lng], com.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapa);
    var limite = datos.limites && datos.limites.madrid;
    if (limite) {
      var estilo = getComputedStyle(document.documentElement);
      L.geoJSON(limite, {
        interactive: false,
        style: { color: estilo.getPropertyValue("--acento").trim() || "#0b6b5c", weight: 2, fillOpacity: 0.06, dashArray: "6 4" }
      }).addTo(mapa);
    }
    capaCentros = L.layerGroup().addTo(mapa);
    capaYo = L.layerGroup().addTo(mapa);
    setTimeout(function () { mapa.invalidateSize(); }, 50);
  }

  function activarMapa() {
    iniciarMapa();
    pintarCentros();
    if (mapa && capaCentros.getLayers().length) {
      mapa.fitBounds(L.featureGroup(capaCentros.getLayers()).getBounds(), { padding: [24, 24], maxZoom: 13 });
    }
    var form = document.getElementById("filtros");
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    form.addEventListener("input", function () {
      filtros.texto = document.getElementById("f-texto").value;
      filtros.terapia = document.getElementById("f-terapia").value;
      filtros.edad = document.getElementById("f-edad").value;
      filtros.accesible = document.getElementById("f-accesible").checked;
      filtros.atencionTemprana = document.getElementById("f-at").checked;
      Array.prototype.forEach.call(form.querySelectorAll("[data-fin]"), function (el) {
        filtros.financiacion[el.getAttribute("data-fin")] = el.checked;
      });
      pintarCentros();
    });
    document.getElementById("cerca").addEventListener("click", function () {
      var aviso = document.getElementById("aviso-ubicacion");
      function fallo() {
        aviso.hidden = false;
        aviso.textContent = "No hemos podido saber dónde estás. Escribe tu municipio o código postal.";
      }
      if (!navigator.geolocation) return fallo();
      try {
        navigator.geolocation.getCurrentPosition(function (pos) {
          miPosicion = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          aviso.hidden = false;
          aviso.textContent = "Ordenados por distancia. Tu ubicación no sale de este dispositivo.";
          if (mapa) {
            capaYo.clearLayers();
            L.marker([miPosicion.lat, miPosicion.lng], { icon: L.divIcon({ className: "", html: '<div class="pin pin--yo"></div>', iconSize: [18, 18] }), title: "Estás aquí" }).addTo(capaYo);
            mapa.setView([miPosicion.lat, miPosicion.lng], 12);
          }
          pintarCentros();
        }, fallo, { timeout: 8000 });
      } catch (e) { fallo(); }
    });
  }

  function vistaCentro(id) {
    var c = porId(datos.centros, id);
    if (!c) return vistaNoEncontrada();
    var terapias = (c.terapias || []).map(function (tid) {
      var g = porId(datos.glosario, tid);
      return g ? '<a class="chip" href="#glosario-' + esc(g.id) + '">' + esc(g.nombre) + "</a>" : "";
    }).join("");
    var web = enlaceSeguro(c.web);
    var edades = c.edad_max >= 99 ? "Desde " + c.edad_min + " años" : "De " + c.edad_min + " a " + c.edad_max + " años";
    function dato(t, v) { return '<div class="dato"><dt>' + esc(t) + "</dt><dd>" + (v || '<span class="pendiente">Pendiente</span>') + "</dd></div>"; }

    return '<p class="miga"><a href="#mapa">Mapa</a></p>' +
      '<section class="lectura"><div class="chips"><span class="chip">' + esc(FINANCIACION[c.financiacion] || c.financiacion) + "</span>" +
      (c.red_atencion_temprana ? '<span class="chip">Red pública de atención temprana</span>' : "") + chipBorrador(c) + "</div>" +
      "<h1>" + esc(c.nombre) + '</h1><p class="entradilla">' + esc(c.descripcion) + "</p></section>" +
      '<div class="ficha"><div class="ficha__cuerpo">' +
      bloque("Terapias", '<div class="chips">' + terapias + "</div>") +
      bloque("Edades que atiende", "<p>" + esc(edades) + "</p>") +
      bloque("Accesibilidad", "<p>" + (c.accesible ? "Accesible en silla de ruedas." : "No consta que sea accesible en silla de ruedas.") + "</p>") +
      bloque("Horario", parrafo(c.horario)) +
      '</div><aside class="ficha__lateral" aria-label="Contacto"><dl class="datos">' +
      dato("Dirección", esc(c.direccion) + "<br>" + esc(c.cp + " " + c.municipio)) +
      dato("Teléfono", esc(c.telefono)) +
      dato("Correo", esc(c.email)) +
      dato("Web", web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener">' + esc(web.replace(/^https?:\/\//, "")) + "</a>" : "") +
      dato("Idiomas", esc((c.idiomas || []).join(", "))) +
      dato("Verificado por mapability", c.verificado ? esc(fechaLarga(c.verificado)) : "") +
      '</dl><a class="boton boton--claro boton--peque" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + c.lat + "&mlon=" + c.lng + '#map=17/' + c.lat + "/" + c.lng + '">Cómo llegar</a>' +
      "</aside></div>";
  }

  /* ---------- glosario ---------- */

  function vistaGlosario() {
    var grupos = Object.keys(TIPOS_GLOSARIO).map(function (tipo) {
      var items = datos.glosario.filter(function (g) { return g.tipo === tipo; })
        .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
      if (!items.length) return "";
      return '<section class="seccion"><h2>' + esc(TIPOS_GLOSARIO[tipo]) + '</h2><ul class="lista">' +
        items.map(function (g) {
          return '<li><a class="fila" href="#glosario-' + esc(g.id) + '"><span class="fila__titulo">' + esc(g.nombre) + "</span>" +
            '<span class="fila__texto">' + esc(g.resumen) + "</span></a></li>";
        }).join("") + "</ul></section>";
    }).join("");
    return '<section class="lectura"><p class="etiqueta">Glosario</p><h1>Qué es cada terapia</h1>' +
      '<p class="entradilla">Explicado en lenguaje claro: para qué sirve, cómo es una sesión y quién la imparte. También las palabras que aparecen en los trámites.</p></section>' +
      '<div class="glosario-grupos">' + grupos + "</div>";
  }

  function vistaTermino(id) {
    var g = porId(datos.glosario, id);
    if (!g) return vistaNoEncontrada();
    var esTerapia = g.tipo !== "termino";
    var centros = datos.centros.filter(function (c) { return (c.terapias || []).indexOf(g.id) !== -1; }).length;
    var tramites = datos.tramites.filter(function (t) { return (t.terapias || []).indexOf(g.id) !== -1; });
    return '<p class="miga"><a href="#glosario">Glosario</a></p>' +
      '<section class="lectura"><div class="chips"><span class="chip">' + esc(TIPOS_GLOSARIO[g.tipo] || g.tipo) + "</span>" + chipBorrador(g) + "</div>" +
      "<h1>" + esc(g.nombre) + '</h1><p class="entradilla">' + esc(g.resumen) + "</p>" +
      (esTerapia && centros ? '<p><a class="boton" href="#mapa-' + esc(g.id) + '">Ver ' + centros + (centros === 1 ? " centro" : " centros") + " en el mapa</a></p>" : "") +
      "</section>" +
      '<div class="ficha__cuerpo">' +
      bloque(esTerapia ? "Qué es" : "Qué significa", parrafo(g.que_es)) +
      (esTerapia ? bloque("A quién suele ayudar", parrafo(g.a_quien_ayuda)) +
        bloque("Cómo es una sesión", parrafo(g.como_es_sesion)) +
        bloque("Quién la imparte", parrafo(g.quien_la_imparte)) +
        bloque("¿La cubre la red pública?", parrafo(g.red_publica)) +
        bloque("Qué dice la evidencia", parrafo(g.evidencia)) : "") +
      (tramites.length ? bloque("Trámites relacionados", "<ul>" + tramites.map(function (t) {
        return '<li><a href="#tramite-' + esc(t.id) + '">' + esc(t.titulo) + "</a></li>";
      }).join("") + "</ul>") : "") +
      '<p class="mapa-nota">Esta información orienta y no sustituye la valoración de un profesional.</p>' +
      "</div>";
  }

  /* ---------- formación ---------- */

  function vistaFormacion() {
    var hoy = new Date().toISOString().slice(0, 10);
    var lista = datos.webinars.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    var proximos = lista.filter(function (w) { return w.fecha >= hoy; });
    var pasados = lista.filter(function (w) { return w.fecha < hoy; });
    function tarjeta(w) {
      var p = (w.fecha || "--").split("-");
      var ins = enlaceSeguro(w.enlace_inscripcion), grab = enlaceSeguro(w.grabacion);
      return '<article class="webinar"><div class="webinar__fecha"><div class="calendario" aria-hidden="true"><b>' + esc(MESES[parseInt(p[1], 10) - 1] || "") + "</b><span>" + esc(parseInt(p[2], 10) || "") + "</span></div>" +
        '<div><p class="etiqueta">' + esc(fechaLarga(w.fecha)) + " · " + esc(w.hora) + " · " + esc(w.duracion_min) + " min</p>" + chipBorrador(w) + "</div></div>" +
        "<h3>" + esc(w.titulo) + "</h3><p>" + esc(w.resumen) + "</p>" +
        (grab ? '<a class="boton boton--claro" href="' + esc(grab) + '" target="_blank" rel="noopener">Ver la grabación</a>'
          : ins ? '<a class="boton" href="' + esc(ins) + '" target="_blank" rel="noopener">Apuntarme</a>'
          : '<span class="chip">Inscripción próximamente</span>') +
        "</article>";
    }
    return '<section class="lectura"><p class="etiqueta">Formación</p><h1>Webinars para familias</h1>' +
      '<p class="entradilla">Sesiones en directo con el equipo de mapability, con tiempo para vuestras preguntas. Las grabaciones quedan disponibles después.</p></section>' +
      '<section class="seccion"><h2>Próximos</h2>' + (proximos.length ? '<div class="webinars">' + proximos.map(tarjeta).join("") + "</div>" : '<p class="vacio">No hay webinars programados ahora mismo.</p>') + "</section>" +
      (pasados.length ? '<section class="seccion"><h2>Grabaciones</h2><div class="webinars">' + pasados.map(tarjeta).join("") + "</div></section>" : "");
  }

  /* ---------- noticias ---------- */

  // El texto de los artículos llega del panel como HTML: solo se dejan pasar etiquetas de texto y enlaces seguros.
  var ETIQUETAS = { P: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, STRONG: 1, B: 1, EM: 1, I: 1, A: 1, BLOCKQUOTE: 1, BR: 1, IMG: 1, FIGURE: 1, FIGCAPTION: 1 };
  function limpiarHtml(html) {
    var doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
    function limpiar(nodo) {
      Array.prototype.slice.call(nodo.childNodes).forEach(function (n) {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1 || !ETIQUETAS[n.tagName]) {
          if (n.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED)$/.test(n.tagName)) {
            limpiar(n);
            while (n.firstChild) nodo.insertBefore(n.firstChild, n);
          }
          nodo.removeChild(n);
          return;
        }
        Array.prototype.slice.call(n.attributes).forEach(function (a) {
          var ok = (n.tagName === "A" && a.name === "href" && /^https?:\/\//i.test(a.value)) ||
            (n.tagName === "IMG" && (a.name === "alt" || (a.name === "src" && /^(https:\/\/|assets\/)/i.test(a.value))));
          if (!ok) n.removeAttribute(a.name);
        });
        if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener"); }
        limpiar(n);
      });
    }
    var raiz = doc.body.firstChild;
    limpiar(raiz);
    return raiz.innerHTML;
  }

  function rutaImagen(src) {
    if (!src) return "";
    src = String(src).replace(/^\//, "");
    return /^https:\/\//i.test(src) || /^assets\//.test(src) ? src : "";
  }

  function tarjetaNoticia(n) {
    var img = rutaImagen(n.imagen);
    return '<a class="noticia" href="#noticia-' + esc(n.id) + '">' +
      (img ? '<img class="noticia__img" src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="noticia__img noticia__img--vacia" aria-hidden="true"></span>') +
      '<span class="noticia__meta">' + esc(CATEGORIAS[n.categoria] || n.categoria || "") + " · " + esc(fechaLarga(n.fecha)) + "</span>" +
      '<span class="noticia__titulo">' + esc(n.titulo) + "</span>" +
      '<span class="noticia__resumen">' + esc(n.resumen) + "</span>" + chipBorrador(n) + "</a>";
  }

  var filtroNoticias = "";
  function vistaNoticias() {
    var cats = Object.keys(CATEGORIAS).filter(function (c) { return datos.noticias.some(function (n) { return n.categoria === c; }); });
    var lista = datos.noticias.filter(function (n) { return !filtroNoticias || n.categoria === filtroNoticias; });
    return '<section class="lectura"><p class="etiqueta">Noticias</p><h1>Novedades para familias</h1>' +
      '<p class="entradilla">Ayudas, investigación y recursos, explicados en lenguaje claro y siempre con su fuente.</p></section>' +
      (cats.length > 1 ? '<div class="chips filtro-noticias" role="group" aria-label="Filtrar por tema">' +
        ['<button class="chip' + (!filtroNoticias ? " chip--activo" : "") + '" data-categoria="" aria-pressed="' + !filtroNoticias + '">Todas</button>'].concat(cats.map(function (c) {
          return '<button class="chip' + (filtroNoticias === c ? " chip--activo" : "") + '" data-categoria="' + c + '" aria-pressed="' + (filtroNoticias === c) + '">' + esc(CATEGORIAS[c]) + "</button>";
        })).join("") + "</div>" : "") +
      (lista.length ? '<div class="noticias">' + lista.map(tarjetaNoticia).join("") + "</div>" : '<p class="vacio">Todavía no hay noticias publicadas.</p>');
  }

  function vistaNoticia(id) {
    var n = porId(datos.noticias, id);
    if (!n) return vistaNoEncontrada();
    var img = rutaImagen(n.imagen), fuente = enlaceSeguro(n.fuente_enlace);
    return '<p class="miga"><a href="#noticias">Noticias</a></p>' +
      '<article class="articulo"><header class="lectura"><div class="chips"><span class="chip">' + esc(CATEGORIAS[n.categoria] || n.categoria || "") + "</span>" + chipBorrador(n) + "</div>" +
      "<h1>" + esc(n.titulo) + '</h1><p class="entradilla">' + esc(n.resumen) + "</p>" +
      '<p class="articulo__meta">' + esc(n.autor || "Equipo de mapability") + " · " + esc(fechaLarga(n.fecha)) + "</p></header>" +
      (img ? '<img class="articulo__img" src="' + esc(img) + '" alt="">' : "") +
      '<div class="articulo__cuerpo">' + limpiarHtml(n.cuerpo) + "</div>" +
      (n.fuente_nombre || fuente ? '<p class="articulo__fuente">Fuente: ' + (fuente ? '<a href="' + esc(fuente) + '" target="_blank" rel="noopener">' + esc(n.fuente_nombre || fuente) + "</a>" : esc(n.fuente_nombre)) + "</p>" : "") +
      "</article>";
  }

  function vistaAcerca() {
    return '<section class="lectura"><p class="etiqueta">Sobre mapability</p><h1>Quiénes somos</h1>' +
      "<p>mapability es un proyecto de dos psicólogos clínicos con experiencia en fundaciones que trabajan con personas con discapacidad. Queremos que ninguna familia tenga que averiguar sola qué le corresponde y a dónde ir.</p>" +
      "<p>Empezamos por la Comunidad de Madrid. Cada ficha indica su fuente oficial y la fecha de su última revisión.</p>" +
      "<p><strong>Tus datos.</strong> La guía, el mapa y el glosario se usan sin registrarse. «Mi plan» se guarda solo en tu dispositivo.</p>" +
      "<p><strong>Independencia.</strong> Los centros que pagan por aparecer destacados siempre se marcan como destacados. La guía y el glosario no dependen de ningún pago.</p>" +
      "</section>";
  }

  function vistaNoEncontrada() {
    return '<section class="lectura"><h1>No encontramos esta página</h1><p>Puede que la ficha se haya movido. <a href="#inicio">Volver al inicio</a>.</p></section>';
  }

  /* ---------- enrutado ---------- */

  var RUTAS = [
    { prefijo: "itinerario-", seccion: "guia", vista: vistaItinerario },
    { prefijo: "tramite-", seccion: "guia", vista: vistaTramite },
    { prefijo: "centro-", seccion: "mapa", vista: vistaCentro },
    { prefijo: "glosario-", seccion: "glosario", vista: vistaTermino },
    { prefijo: "mapa-", seccion: "mapa", vista: vistaMapa, mapa: true },
    { prefijo: "noticia-", seccion: "noticias", vista: vistaNoticia }
  ];
  var FIJAS = {
    inicio: { vista: vistaInicio },
    guia: { vista: vistaGuia, activar: activarGuia },
    "mi-plan": { seccion: "guia", vista: vistaMiPlan },
    mapa: { vista: function () { return vistaMapa(""); }, mapa: true },
    glosario: { vista: vistaGlosario },
    formacion: { vista: vistaFormacion },
    noticias: { vista: vistaNoticias },
    acerca: { vista: vistaAcerca }
  };

  function pintar(conservarPosicion) {
    var hash = (location.hash || "").replace(/^#/, "") || "inicio";
    var ruta = FIJAS[hash], param = null, seccion = hash;
    if (ruta) {
      seccion = ruta.seccion || hash;
    } else {
      for (var i = 0; i < RUTAS.length; i++) {
        if (hash.indexOf(RUTAS[i].prefijo) === 0) {
          ruta = RUTAS[i];
          param = hash.slice(RUTAS[i].prefijo.length);
          seccion = ruta.seccion;
          break;
        }
      }
    }
    if (mapa) { mapa.remove(); mapa = null; }
    if (!ruta) { main.innerHTML = vistaNoEncontrada(); seccion = ""; }
    else {
      main.innerHTML = ruta.vista(param);
      if (ruta.mapa) activarMapa();
      if (ruta.activar) ruta.activar();
    }
    Array.prototype.forEach.call(document.querySelectorAll(".menu a"), function (a) {
      if (a.getAttribute("data-seccion") === seccion) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    var h1 = main.querySelector("h1");
    document.title = (h1 && hash !== "inicio" ? h1.textContent + " · " : "") + "mapability";
    if (conservarPosicion === true) return;
    window.scrollTo(0, 0);
    if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
  }

  document.querySelector(".saltar").addEventListener("click", function (e) {
    e.preventDefault();
    main.focus();
  });

  main.addEventListener("click", function (e) {
    var cat = e.target.closest("[data-categoria]");
    if (cat) {
      filtroNoticias = cat.getAttribute("data-categoria");
      pintar(true);
      return;
    }
    var todos = e.target.closest("[data-plan-todos]");
    if (todos) {
      var it = porId(datos.itinerarios, todos.getAttribute("data-plan-todos"));
      var plan = leerPlan();
      (it ? it.pasos : []).forEach(function (p) { if (!plan[p.tramite]) plan[p.tramite] = "pendiente"; });
      guardarPlan(plan);
      location.hash = "mi-plan";
      return;
    }
    var b = e.target.closest("[data-plan]");
    if (!b) return;
    e.preventDefault();
    cambiarEstado(b.getAttribute("data-plan"), b.getAttribute("data-estado"));
    var y = window.scrollY;
    pintar(true);
    window.scrollTo(0, y);
  });

  cargar().then(function (d) {
    datos = d;
    window.addEventListener("hashchange", function () { pintar(); });
    pintar();
  }).catch(function () {
    main.innerHTML = '<p class="vacio">No se ha podido cargar el contenido. Comprueba la conexión y vuelve a intentarlo.</p>';
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) { /* sin service worker */ }
  }
})();
