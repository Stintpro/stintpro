window.CircuitDB = {
  list: [],

  // Cargar circuitos guardados por el usuario desde localStorage
  _loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem('karting_circuits') || '[]');
      saved.forEach(c => {
        if (!this.list.find(x => x.slug === c.slug)) this.list.push(c);
      });
    } catch(e) {}
  },

  // Guardar un circuito nuevo
  save(name, slug, port) {
    const id = 'custom_' + slug;
    const existing = this.list.find(x => x.slug === slug);
    if (existing) {
      existing.name = name;
      existing.port = port;
    } else {
      this.list.push({ id, name, slug, port, _custom: true });
    }
    this._persist();
    return id;
  },

  // Borrar un circuito personalizado
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

// Cargar circuitos guardados al iniciar
window.CircuitDB._loadSaved();
