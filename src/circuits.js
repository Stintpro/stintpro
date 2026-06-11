// Catálogo de circuitos conocidos — se distribuyen con la app (sin localStorage)
// Para añadir un circuito: copia una línea del array, rellena nombre/slug/puerto y haz deploy.
// El slug es el identificador que aparece en la URL de Apex Timing (ej: apextiming.eu/live/rkc)
// Puerto por defecto: 7913 (consulta con el circuito si no funciona)
const _CIRCUIT_CATALOG = [
  // { id: 'cat_rkc',      name: 'Henakart (RKC)',        slug: 'rkc',      port: 7913 },
  // { id: 'cat_example',  name: 'Nombre del circuito',   slug: 'slug',     port: 7913 },
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

// Carga async desde Supabase — llamar tras auth, antes de renderSetup()
window.CircuitDB.loadFromSupabase = async function() {
  if (!window.supabaseClient) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('circuits').select('*').order('name');
    if (!error && data) {
      data.forEach(c => this.add({
        id:         'sb_' + c.id,
        name:       c.name,
        slug:       c.slug,
        port:       c.port || 7913,
        _supabase:  true,
        _sbId:      c.id
      }));
    }
  } catch(e) {
    console.warn('[StintPro] No se pudieron cargar circuitos de Supabase:', e.message);
  }
};

// Cargar circuitos al iniciar
window.CircuitDB._loadSaved();
