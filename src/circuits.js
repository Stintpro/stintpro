// Catálogo de circuitos conocidos — se distribuyen con la app (sin localStorage)
// Para añadir un circuito: copia una línea del array, rellena nombre/slug/puerto y haz deploy.
// El slug es el identificador que aparece en la URL de Apex Timing (ej: apextiming.eu/live/rkc)
// Puerto por defecto: 7913 (consulta con el circuito si no funciona)
const _CIRCUIT_CATALOG = [
  { id: 'cat_cabanillas',   name: 'Karting Cabanillas',        slug: 'cabanillas',       port: 10433 },
  { id: 'cat_campillos',    name: 'Karting Campillos',         slug: 'campillos',        port: 9373  },
  { id: 'cat_lossantos',    name: 'Karting Club Los Santos',   slug: 'karting-lossantos',port: 8093  },
  { id: 'cat_rivas',        name: 'Karting Rivas',             slug: 'rivas',            port: 10073 },
  { id: 'cat_sevilla',      name: 'Karting Sevilla',           slug: 'sevilla',          port: 6953  },
  { id: 'cat_henakart',     name: 'Henakart',                  slug: 'henakart',         port: 9983  },
  { id: 'cat_rkc',          name: 'RKC Paris',                 slug: 'rkc',              port: 7913  },
  { id: 'cat_rkc2',         name: 'RKC Paris 2',               slug: 'rkc2',             port: 9263  },
  { id: 'cat_lucasguerrero', name: 'Circuito Lucas Guerrero',  slug: 'kartodromo-lucas-guerrero', port: 9953 },
  { id: 'cat_ariza',        name: 'Ariza Racing Circuit',      slug: 'ariza-racing-circuit',      port: 8973 },
  { id: 'cat_osona',        name: 'Circuito de Osona',         slug: 'circuitosona',              port: 9623 },
  { id: 'cat_kippalmela',   name: 'KIP Palmela',               slug: 'kip-palmela',               port: 10113 }, // Portugal (configPort 10110 + 3)
  { id: 'cat_lemans',       name: 'Le Mans Karting 2 (FR)',    slug: 'lemans-karting2',           port: 8013  }, // Francia — 24H Open Kart 390cc
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

// Offsets pit exit→meta ya medidos en sesiones reales — listos desde la selección
// del circuito en CUALQUIER dispositivo/navegador, sin depender del localStorage
// local (que solo se rellena tras calibrar 2 paradas en ESE dispositivo). Se usan
// solo como fallback: si el dispositivo ya tiene su propia calibración guardada
// (más reciente/afinada), esa tiene prioridad. Propiedad separada de `list` para
// que sobreviva a loadFromSupabase() (que reemplaza `list` pero no toca esto).
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

// Carga async desde Supabase — Supabase es la fuente de verdad, catálogo hardcodeado es fallback
window.CircuitDB.loadFromSupabase = async function() {
  if (!window.supabaseClient) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('circuits').select('*').order('name');
    if (!error && data && data.length > 0) {
      const custom = this.list.filter(c => c._custom);
      this.list = [
        ...data.map(c => ({ id:'sb_'+c.id, name:c.name, slug:c.slug, port:c.port||7913, _supabase:true, _sbId:c.id })),
        ...custom.filter(c => !data.find(d => d.slug === c.slug))
      ];
    }
  } catch(e) {
    console.warn('[StintPro] No se pudieron cargar circuitos de Supabase:', e.message);
  }
};

// Cargar circuitos al iniciar
window.CircuitDB._loadSaved();
