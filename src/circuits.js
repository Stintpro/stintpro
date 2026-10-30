// Catálogo de circuitos conocidos — se distribuyen con la app (sin localStorage)
// Para añadir un circuito: copia una línea del array, rellena nombre/slug/puerto y haz deploy.
// El slug es el identificador que aparece en la URL de Apex Timing (ej: apextiming.eu/live/rkc)
// Puerto por defecto: 7913 (consulta con el circuito si no funciona)
// `country` = clave de CircuitDB.countries (grupo del desplegable); SERIE = canal itinerante.
const _CIRCUIT_CATALOG = [
  { id: 'cat_cabanillas',    name: 'Cabanillas',                   slug: 'cabanillas',                 port: 10433, country: 'ES' },
  { id: 'cat_campillos',     name: 'Campillos',                    slug: 'campillos',                  port: 9373,  country: 'ES' },
  { id: 'cat_lossantos',     name: 'Los Santos',                   slug: 'karting-lossantos',          port: 8093,  country: 'ES' },
  { id: 'cat_rivas',         name: 'Rivas',                        slug: 'rivas',                      port: 10073, country: 'ES' },
  { id: 'cat_sevilla',       name: 'Sevilla',                      slug: 'sevilla',                    port: 6953,  country: 'ES' },
  { id: 'cat_henakart',      name: 'Henakart',                     slug: 'henakart',                   port: 9983,  country: 'ES' },
  { id: 'cat_rkc',           name: 'RKC Paris',                    slug: 'rkc',                        port: 7913,  country: 'FR' },
  { id: 'cat_rkc2',          name: 'RKC Paris 2',                  slug: 'rkc2',                       port: 9263,  country: 'FR' },
  { id: 'cat_lucasguerrero', name: 'Lucas Guerrero',               slug: 'kartodromo-lucas-guerrero',  port: 9953,  country: 'ES' },
  { id: 'cat_ariza',         name: 'Ariza Racing Circuit',         slug: 'ariza-racing-circuit',       port: 8973,  country: 'ES' },
  { id: 'cat_osona',         name: 'Osona',                        slug: 'circuitosona',               port: 9623,  country: 'ES' },
  { id: 'cat_kippalmela',    name: 'KIP Palmela',                  slug: 'kip-palmela',                port: 10113, country: 'PT' }, // Portugal (configPort 10110 + 3)
  { id: 'cat_lemans',        name: 'Le Mans Karting',              slug: 'lemans-karting2',            port: 8013,  country: 'FR' }, // Francia — 24H Open Kart 390cc
  // Circuitos que graba el logger del VPS (puertos de /api/status, 2026-10-26).
  { id: 'cat_korridas',      name: 'Korridas',                     slug: 'korridas',                   port: 7633,  country: 'SERIE' }, // Portugal (Matosinhos)
  { id: 'cat_tapia',         name: 'Tapia',                        slug: 'kartodromo-de-tapia',        port: 8443,  country: 'ES' },
  { id: 'cat_misanino',      name: 'Misanino Kart',                slug: 'misanino-kart',              port: 8043,  country: 'IT' },
  { id: 'cat_worldkarts',    name: 'WorldKarts',                   slug: 'worldkarts',                 port: 8143,  country: 'BE' },
  { id: 'cat_firstkartinn',  name: 'First Kart Inn',               slug: 'firstkartinn',               port: 8113,  country: 'BE' },
  { id: 'cat_grancanaria',   name: 'Gran Canaria',                 slug: 'grancanaria-karting',        port: 9183,  country: 'ES' },
  { id: 'cat_prestige',      name: 'Prestige Karting',             slug: 'prestige-karting',           port: 9613,  country: 'FR' }, // Francia (Le Luc)
  { id: 'cat_alcanede',      name: 'Alcanede',                     slug: 'kartalcanede',               port: 9743,  country: 'PT' }, // Portugal (configPort 9740 + 3); solo emite con evento en pista
  // Cronosystem = canal del CRONOMETRADOR, itinerante (no es un circuito fijo): 24H KIP
  // Portugal en sept-2026, 30H Campillos en oct-2026. Puerto real 8803 (el configPort
  // 8800 de Apex no hace TLS). El trazado va por trackAliases, más abajo.
  { id: 'cat_cronosystem2',  name: 'Cronosystem (30H Campillos)',  slug: 'cronosystem2',               port: 8803,  country: 'SERIE' },
];

window.CircuitDB = {
  list: [],

  _loadSaved() {
    // 1. Cargar catálogo embebido (no editable por el usuario)
    _CIRCUIT_CATALOG.forEach(c => this.add(c));

    // 2. Cargar circuitos personalizados guardados por el usuario
    try {
      const saved = JSON.parse(localStorage.getItem('karting_circuits') || '[]');
      saved.forEach(c => {
        if (!this.list.find(x => x.slug === c.slug)) this.list.push(c);
      });
    } catch(e) {}
  },

  // Guardar un circuito nuevo (siempre custom, nunca sobreescribe el catálogo)
  save(name, slug, port) {
    const id = 'custom_' + slug;
    const existing = this.list.find(x => x.slug === slug && x._custom);
    if (existing) {
      existing.name = name;
      existing.port = port;
    } else {
      this.list.push({ id, name, slug, port, _custom: true });
    }
    this._persist();
    return id;
  },

  // Borrar un circuito personalizado (los del catálogo no son borrables)
  remove(slug) {
    const idx = this.list.findIndex(c => c.slug === slug && c._custom);
    if (idx !== -1) {
      this.list.splice(idx, 1);
      this._persist();
      return true;
    }
    return false;
  },

  _persist() {
    try {
      const custom = this.list.filter(c => c._custom);
      localStorage.setItem('karting_circuits', JSON.stringify(custom));
    } catch(e) {}
  },

  add(circuit) {
    if (!this.list.find(c => c.slug === circuit.slug)) this.list.push(circuit);
  }
};

// Grupos del desplegable, en este orden. La bandera tiene que ser emoji: un <optgroup>
// no admite imágenes (Windows pinta las letras del país en vez de la bandera).
window.CircuitDB.countries = [
  { key: 'ES',    label: '🇪🇸 España' },
  { key: 'PT',    label: '🇵🇹 Portugal' },
  { key: 'FR',    label: '🇫🇷 Francia' },
  { key: 'BE',    label: '🇧🇪 Bélgica' },
  { key: 'IT',    label: '🇮🇹 Italia' },
  { key: 'SERIE', label: '🏁 Series itinerantes' },
];

// Circuitos por grupo, alfabéticos dentro de cada uno; los del usuario, al final.
window.CircuitDB.grouped = function() {
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const inGroup = key => this.list.filter(c => !c._custom && c.country === key).sort(byName);
  const groups = this.countries.map(g => ({ label: g.label, circuits: inGroup(g.key) }));
  const known = new Set(this.countries.map(g => g.key));
  groups.push({ label: 'Mis circuitos', circuits: this.list.filter(c => c._custom || !known.has(c.country)).sort(byName) });
  return groups.filter(g => g.circuits.length);
};

// <optgroup>s del selector de circuito del setup.
window.CircuitDB.optionsHtml = function() {
  return this.grouped().map(g => `<optgroup label="${g.label}">` +
    g.circuits.map(c => `<option value="${c.id}"${c._custom?' data-custom="1"':''}>${c.name}${c._custom?' ✕':''}</option>`).join('') +
    '</optgroup>').join('');
};

// Offsets pit exit→meta ya medidos en sesiones reales — listos desde la selección
// del circuito en CUALQUIER dispositivo/navegador, sin depender del localStorage
// local (que solo se rellena tras calibrar 2 paradas en ESE dispositivo). Se usan
// solo como fallback: si el dispositivo ya tiene su propia calibración guardada
// (más reciente/afinada), esa tiene prioridad. Propiedad separada de `list` para
// que no dependa del orden de carga de `list`.
// Valor: número (un solo sentido conocido) u objeto {normal, inverso} para
// circuitos que corren en ambos sentidos según el evento — el offset pit
// exit→meta cambia radicalmente según el sentido (Apex no lo indica en el
// feed, así que hay que seleccionarlo a mano en el setup).
window.CircuitDB.knownOffsets = {
  'karting-lossantos': 8.0, // N=58 combinado, sesiones 2026-06-27 (3H Resistencia) + 2026-07-10 (IRONMAN entrenos)
  'ariza-racing-circuit': { inverso: 38.7 }, // N=21, sesión 2026-07-03 (2H Amateur Final) — sentido normal aún sin medir
  // Henakart: la COPA PISTON 2026 (2026-08-01) invierte el sentido a mitad de carrera
  // con parada sincronizada de toda la parrilla → un solo log da los dos sentidos.
  // normal=2ª mitad (pit-exit a ~1 vuelta de meta), inverso=1ª mitad+cronos.
  'henakart': { normal: 39.5, inverso: 20.0 }, // N=79 normal / N=42 inverso, cadena so→primer |*|
};

// ¿Este circuito tiene offsets distintos según el sentido de la pista?
window.CircuitDB.hasDirectionVariants = function(slug) {
  return typeof this.knownOffsets[slug] === 'object' && this.knownOffsets[slug] !== null;
};

// Offset conocido de fábrica para un circuito (y sentido, si aplica).
window.CircuitDB.getKnownOffset = function(slug, direction) {
  const entry = this.knownOffsets[slug];
  if (entry == null) return undefined;
  if (typeof entry === 'number') return entry;
  return entry[direction || 'normal'];
};

// Clave de localStorage para el offset calibrado en ESTE dispositivo —
// separada por sentido solo para circuitos con hasDirectionVariants.
window.CircuitDB.pitOffsetKey = function(slug, direction) {
  return this.hasDirectionVariants(slug)
    ? 'stintpro_pitoffset_' + slug + '_' + (direction || 'normal')
    : 'stintpro_pitoffset_' + slug;
};

// Trazado GPS prestado: slug cuyo mapa (src/tracks/<slug>.json) es el de OTRO
// circuito. Para canales itinerantes de cronometrador: cambiar aquí cuando el
// canal se mude de pista. Solo afecta al dibujo de la pestaña Pista; offsets y
// calibraciones siguen yendo por el slug propio.
window.CircuitDB.trackAliases = {
  'cronosystem2': 'campillos', // 30H Campillos 2026
};
window.CircuitDB.trackSlug = function(slug) {
  return this.trackAliases[slug] || slug;
};

// Coordenadas [lat, lon] de cada circuito, para la meteo (en-weather.js). Van por
// slug, aparte de `list`. Las de
// ariza/henakart/los santos son el centro de la vuelta GPS de su trazado; el resto,
// OpenStreetMap. Un canal itinerante (cronosystem2) hereda las de su pista por
// trackAliases.
window.CircuitDB.coords = {
  'ariza-racing-circuit':      [40.06576, -4.19387],
  'cabanillas':                [40.62894, -3.24569],
  'campillos':                 [37.03822, -4.91438],
  'henakart':                  [40.42828, -3.44353],
  'karting-lossantos':         [40.49458, -3.25061],
  'rivas':                     [40.34716, -3.53535],
  'sevilla':                   [37.55845, -5.93243],
  'rkc':                       [49.10388,  2.03663],
  'rkc2':                      [49.10388,  2.03663],
  'kartodromo-lucas-guerrero': [39.50822, -0.74679],
  'circuitosona':              [41.95034,  2.28088],
  'kip-palmela':               [38.57828, -8.82769],
  'lemans-karting2':           [47.94232,  0.21241],
  'korridas':                  [41.17568, -8.68299],
  'kartodromo-de-tapia':       [43.54655, -6.90399],
  'firstkartinn':              [50.90603,  4.41669],
  'prestige-karting':          [43.34890,  6.33847],
  'kartalcanede':              [39.42263, -8.80469],
  // Sin coordenadas aún (no se muestra el aviso de lluvia): misanino-kart,
  // worldkarts (OSM da dos sedes) y grancanaria-karting.
};
window.CircuitDB.coordsOf = function(slug) {
  if (!slug) return null;
  return this.coords[slug] || this.coords[this.trackSlug(slug)] || null;
};

// Cargar circuitos al iniciar
window.CircuitDB._loadSaved();
