'use strict';

// Agrupación por país de los circuitos del logger (portada, /recordings y /stats),
// con los mismos grupos y orden que la app (src/circuits.js) y la app del piloto.

const { COUNTRIES, countryOf, sortByCountry } = require('../circuit-countries');
const { createTestServer } = require('./helpers/test-server');
const http = require('http');

describe('circuit-countries', () => {
  test('grupos en el mismo orden que la app', () => {
    expect(COUNTRIES.map(g => g.key)).toEqual(['ES', 'PT', 'FR', 'BE', 'IT', 'SERIE', 'OTROS']);
  });

  test('país conocido por slug, incluidos los 5 añadidos el 2026-11-22', () => {
    expect(countryOf('campillos')).toBe('ES');
    expect(countryOf('karting-vendrell')).toBe('ES');
    expect(countryOf('kartodromodebaltar')).toBe('PT');
    expect(countryOf('rkc2')).toBe('FR');
    expect(countryOf('cronosystem2')).toBe('SERIE');
  });

  test('un circuito desconocido va a OTROS salvo que su config traiga país', () => {
    expect(countryOf('nuevo-circuito')).toBe('OTROS');
    expect(countryOf('nuevo-circuito', 'pt')).toBe('PT');
    expect(countryOf('nuevo-circuito', 'XX')).toBe('OTROS');
  });

  test('ordena por grupo y alfabético dentro de cada uno', () => {
    const list = [
      { slug: 'korridas', name: 'Korridas' },
      { slug: 'rkc', name: 'RKC Paris' },
      { slug: 'sevilla', name: 'Sevilla' },
      { slug: 'nuevo', name: 'Nuevo' },
      { slug: 'kip-palmela', name: 'KIP Palmela' },
      { slug: 'ariza-racing-circuit', name: 'Ariza Racing Circuit' },
    ];
    expect(sortByCountry(list).map(c => c.slug))
      .toEqual(['ariza-racing-circuit', 'sevilla', 'kip-palmela', 'rkc', 'korridas', 'nuevo']);
  });
});

describe('/api/status con país', () => {
  let server, baseUrl;
  beforeAll(async () => { await require('../db').init(); ({ server, baseUrl } = await createTestServer()); });
  afterAll(() => new Promise(r => server.close(r)));

  test('cada circuito trae country y la respuesta trae los grupos', async () => {
    const body = await new Promise((resolve, reject) => {
      http.get(baseUrl + '/api/status', res => {
        let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(JSON.parse(b)));
      }).on('error', reject);
    });
    expect(body.countries.map(g => g.key)).toEqual(COUNTRIES.map(g => g.key));
    expect(body.circuits[0].country).toBe('OTROS'); // test-slug no está en el mapa
  });
});
