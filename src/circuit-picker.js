// Desplegable de circuito con cabeceras de país destacadas. macOS pinta el <select>
// con su menú nativo e ignora el CSS de los <optgroup>, así que este componente lo
// sustituye visualmente. El <select> sigue siendo la fuente de verdad: queda oculto,
// el resto del código lee su .value y su `change`. Tras cambiarlo por código, sync().
window.CircuitPicker = (function () {
  let current = null; // desplegable abierto: { select, button, list, options, active }

  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function sync(select) {
    const button = select && select._cpButton;
    if (!button) return;
    const opt = select.options[select.selectedIndex];
    const text = opt ? opt.textContent : '';
    button.querySelector('.cp-value').textContent = text;
    button.classList.toggle('cp-empty', !select.value);
    button.setAttribute('aria-label', 'Circuito: ' + text);
  }

  function attach(select) {
    if (!select || select._cpButton) { sync(select); return; }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cp-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="cp-value"></span><span class="cp-chevron" aria-hidden="true"></span>';
    select._cpButton = button;
    select.classList.add('cp-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.after(button);
    button.addEventListener('click', () => {
      if (current && current.select === select) close();
      else open(select);
    });
    button.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(select); }
    });
    sync(select);
  }

  function buildList(select) {
    const list = document.createElement('div');
    list.className = 'cp-list';
    list.id = 'cp-list';
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    const options = [];
    const addOption = (opt, parent) => {
      const row = document.createElement('div');
      row.className = 'cp-option';
      row.id = 'cp-opt-' + options.length;
      row.setAttribute('role', 'option');
      row.textContent = opt.textContent;
      row.dataset.value = opt.value;
      row.setAttribute('aria-selected', String(opt.value === select.value));
      row.addEventListener('click', () => choose(opt.value));
      row.addEventListener('mousemove', () => setActive(options.indexOf(row), false));
      parent.append(row);
      options.push(row);
    };
    for (const child of select.children) {
      if (child.tagName === 'OPTGROUP') {
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        const head = document.createElement('div');
        head.className = 'cp-group';
        head.id = 'cp-group-' + list.children.length;
        head.textContent = child.label;
        group.setAttribute('aria-labelledby', head.id);
        group.append(head);
        for (const opt of child.children) addOption(opt, group);
        list.append(group);
      } else if (child.value) { // la opción vacía ya la muestra el botón
        addOption(child, list);
      }
    }
    return { list, options };
  }

  function place(button, list) {
    const r = button.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - r.bottom - margin * 2;
    const above = r.top - margin * 2;
    const up = below < 280 && above > below;
    const width = Math.min(Math.max(r.width, 300), window.innerWidth - margin * 2);
    list.style.width = width + 'px';
    list.style.left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin)) + 'px';
    list.style.maxHeight = (up ? above : below) + 'px';
    list.style.top = up ? '' : (r.bottom + 6) + 'px';
    list.style.bottom = up ? (window.innerHeight - r.top + 6) + 'px' : '';
  }

  function setActive(index, scroll) {
    const c = current;
    if (!c || index === c.active || index < 0 || index >= c.options.length) return;
    if (c.active >= 0) c.options[c.active].classList.remove('cp-active');
    c.active = index;
    const row = c.options[index];
    row.classList.add('cp-active');
    c.list.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  function open(select) {
    close();
    const button = select._cpButton;
    const { list, options } = buildList(select);
    current = { select, button, list, options, active: -1 };
    document.body.append(list);
    place(button, list);
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', list.id);
    setActive(Math.max(0, options.findIndex(o => o.dataset.value === select.value)), true);
    list.focus({ preventScroll: true });
    list.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
  }

  function close() {
    const c = current;
    if (!c) return;
    current = null;
    c.list.remove();
    c.button.setAttribute('aria-expanded', 'false');
    c.button.removeAttribute('aria-controls');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
  }

  function choose(value) {
    const { select, button } = current;
    const changed = select.value !== value;
    close();
    button.focus();
    if (!changed) return;
    select.value = value;
    sync(select);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onOutside(e) {
    if (current.list.contains(e.target) || current.button.contains(e.target)) return;
    close();
  }

  function onScroll(e) {
    if (current && e.target !== current.list) close();
  }

  function onKey(e) {
    const c = current;
    const last = c.options.length - 1;
    if (e.key === 'ArrowDown') setActive(Math.min(c.active + 1, last), true);
    else if (e.key === 'ArrowUp') setActive(Math.max(c.active - 1, 0), true);
    else if (e.key === 'Home') setActive(0, true);
    else if (e.key === 'End') setActive(last, true);
    else if (e.key === 'Enter' || e.key === ' ') choose(c.options[c.active].dataset.value);
    else if (e.key === 'Escape') { const b = c.button; close(); b.focus(); }
    else if (e.key === 'Tab') { close(); return; }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // Salta al siguiente circuito que empieza por esa letra.
      const k = norm(e.key);
      for (let i = 1; i <= c.options.length; i++) {
        const j = (c.active + i) % c.options.length;
        if (norm(c.options[j].textContent).startsWith(k)) { setActive(j, true); break; }
      }
    } else return;
    e.preventDefault();
  }

  return { attach, sync };
})();
