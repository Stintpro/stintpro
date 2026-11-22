'use strict';

// País de cada circuito del logger, para agrupar las listas de los paneles
// (portada, /recordings y /stats) igual que la app (src/circuits.js) y la app
// del piloto. Un circuito añadido en caliente que no esté aquí va a «Otros»,
// salvo que su entrada de config.json traiga `country`.

const COUNTRIES = [
  { key: 'ES',    label: '🇪🇸 España' },
  { key: 'PT',    label: '🇵🇹 Portugal' },
  { key: 'FR',    label: '🇫🇷 Francia' },
  { key: 'BE',    label: '🇧🇪 Bélgica' },
  { key: 'IT',    label: '🇮🇹 Italia' },
  { key: 'SERIE', label: '🏁 Series itinerantes' },
  { key: 'OTROS', label: '❔ Otros' },
];

const BY_SLUG = {
  'ariza-racing-circuit': 'ES', 'cabanillas': 'ES', 'campillos': 'ES', 'circuito-dr7': 'ES',
  'grancanaria-karting': 'ES', 'henakart': 'ES', 'karting-lossantos': 'ES',
  'kartodromo-lucas-guerrero': 'ES', 'circuitosona': 'ES', 'rivas': 'ES', 'sevilla': 'ES',
  'karting-sevilla': 'ES', 'kartodromo-de-tapia': 'ES', 'karting-vendrell': 'ES',
  'kartalcanede': 'PT', 'kip-palmela': 'PT', 'kartodromodeviana': 'PT',
  'cabodomundokarting': 'PT', 'kartodromodebaltar': 'PT',
  'lemans-karting2': 'FR', 'prestige-karting': 'FR', 'rkc': 'FR', 'rkc2': 'FR',
  'firstkartinn': 'BE', 'worldkarts': 'BE',
  'misanino-kart': 'IT',
  'cronosystem2': 'SERIE', 'korridas': 'SERIE',
};

const KEYS = COUNTRIES.map(g => g.key);

function countryOf(slug, configured) {
  const c = String(configured || '').toUpperCase();
  if (KEYS.includes(c)) return c;
  if (configured) return 'OTROS';
  return BY_SLUG[slug] || 'OTROS';
}

// Copia ordenada: por grupo (orden de COUNTRIES) y por nombre dentro de cada uno.
function sortByCountry(circuits) {
  return circuits
    .map(c => ({ ...c, country: countryOf(c.slug, c.country) }))
    .sort((a, b) => KEYS.indexOf(a.country) - KEYS.indexOf(b.country)
      || String(a.name || a.slug).localeCompare(String(b.name || b.slug), 'es'));
}

module.exports = { COUNTRIES, countryOf, sortByCountry };
