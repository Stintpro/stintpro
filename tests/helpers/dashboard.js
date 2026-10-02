// Arnés: carga los src/*.js del dashboard endurance en un vm con un DOM mínimo,
// reloj controlable y localStorage en memoria. Captura el handler de datos que
// showEnduranceDashboard registra en ApexConnector.connect y los setInterval
// (el reloj de 1 s), para poder alimentar ticks como lo haría el conector.
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const FILES = ['clock.js', 'circuits.js', 'en-traffic.js', 'analysis.js', 'helpers.js', 'en-state.js',
  'en-stint-machine.js', 'en-box-model.js', 'en-pit-windows.js', 'en-persist.js', 'en-columns.js',
  'en-strategy.js', 'en-wave.js'];

function el() {
  return {
    classList: { add() {}, remove() {}, contains() { return false; } }, style: {}, innerHTML: '', textContent: '',
    childNodes: [{}], dataset: {}, querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, addEventListener() {},
  };
}

module.exports = function makeDashboard(opts = {}) {
  let NOW = opts.now || 1_800_000_000_000;
  const RealDate = Date;
  class FDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
    static now() { return NOW; }
  }
  const store = {};
  const intervals = [];
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => console.error(...a) },
    Date: FDate, Math, JSON,
    setTimeout: () => 0, clearTimeout() {},
    setInterval: (f) => { intervals.push(f); return intervals.length; },
    clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: { getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el() },
    confirm: () => true,
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`
    var __cb = null;
    _enInjectStyles = function(){}; _enRender = function(){}; _enScheduleRender = function(){};
    _enInjectSetupBtn = function(){}; _enInjectColumnsBtn = function(){}; _enShowPilotSelect = function(){};
    _enUpdateKpis = function(){}; _enUpdateBars = function(){}; _enStopAdvRaf = function(){};
    var _enAiEngineer = {}; var renderSetup = function(){};
    window.ApexConnector = { connect: function(slug, cb){ __cb = cb; }, disconnect(){} };
    window.AppState = { config: {} };
  `, ctx);
  const run = (c) => vm.runInContext(c, ctx);
  return {
    ctx, store, run,
    now: () => NOW,
    setNow: (t) => { NOW = t; },
    // Abre el dashboard con esta config (como al pulsar "Empezar" en el setup)
    open(cfg) { ctx.AppState.config = cfg; ctx.showEnduranceDashboard(cfg); },
    // Un mensaje del conector (directo o logger)
    feed(data) { run('__cb')(data); },
    // Un tic del reloj de 1 s del dashboard
    tick() { intervals.slice().forEach((f) => f()); },
  };
};
