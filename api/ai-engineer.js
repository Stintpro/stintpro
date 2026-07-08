// Vercel Serverless Function — IA "ingeniero de pista"
// Variables de entorno necesarias en Vercel:
//   SUPABASE_URL         → igual que en supabase-config.js
//   SUPABASE_SERVICE_KEY → Settings → API → service_role (NUNCA en el cliente)
//   ANTHROPIC_API_KEY    → console.anthropic.com (NUNCA en el cliente)

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

// Config por tipo consolidada en un único objeto — evita que un tipo nuevo
// se quede sin entrada en uno de varios mapas paralelos por descuido.
// Nota sobre los gaps de "rivals" en el snapshot: `realGap` es la diferencia
// real en pista ahora mismo; `estimatedGap` ya SUMA la penalización de las
// paradas pendientes de ese rival (proyección de "si todos hicieran las
// paradas que les faltan"). Son números distintos — el prompt de cada tipo
// lo deja explícito para que no se mezclen al redactar.
const GAP_NOTE = `Sobre los gaps de "rivals": "realGap" es la diferencia real en pista ahora mismo; "estimatedGap" ya incluye la penalización de las paradas pendientes de ese rival (proyección a futuro, no el hueco actual). Son números distintos — si mencionas "estimatedGap", dilo explícitamente como proyección ("con sus paradas pendientes, el hueco equivalente sería de ~Xs"), nunca como si fuera la diferencia real ahora mismo en pista.`;

const AI_TYPES = {
  alert: {
    model: 'claude-haiku-4-5',
    maxTokens: 400,
    systemPrompt: `Eres el ingeniero de pista de un equipo de karting endurance. Recibes un snapshot JSON del estado de la carrera justo después de detectarse un cambio relevante (rival recortando, ventana de parada favorable, deuda de paradas crítica de un rival, etc.).

${GAP_NOTE}

Responde en 1-2 frases cortas, directas, estilo aviso de radio de carrera. Interpreta el cambio, no repitas los números crudos. No inventes datos que no estén en el JSON. Si el cambio no requiere ninguna acción del equipo, dilo brevemente igualmente.`,
  },
  bulletin: {
    model: 'claude-sonnet-5',
    maxTokens: 1024,
    systemPrompt: `Eres el ingeniero de pista de un equipo de karting endurance. Recibes un snapshot JSON periódico con: posición y estado del plan de paradas de tu equipo (semáforo de viabilidad, si está en boxes ahora mismo), probabilidad de conseguir un kart bueno en boxes, nivel de tráfico en la reentrada, y los rivales más cercanos (gap real y gap estimado corregido por paradas pendientes, ritmo reciente, calidad de kart, paradas que le faltan).

${GAP_NOTE}

Da un boletín breve estilo radio de carreras, 3-5 frases: posición y gap real actual, estado del plan de paradas, quién es la amenaza real (no necesariamente el más cercano en la clasificación bruta — mira ritmo y paradas pendientes), y una recomendación concreta si aplica. Directo, sin tecnicismos de más. No inventes nada que no esté en el JSON.`,
  },
  query: {
    model: 'claude-sonnet-5',
    maxTokens: 1024,
    systemPrompt: `Eres el ingeniero de pista de un equipo de karting endurance. El equipo te hace una pregunta concreta durante la carrera (p.ej. "¿apuro este stint o paro ya?"). Tienes el snapshot JSON con el estado actual de la carrera.

${GAP_NOTE}

Responde a la pregunta de forma directa y concreta, con una recomendación clara si la pregunta la pide. Basa la respuesta solo en los datos del snapshot — si falta un dato necesario para responder con seguridad, dilo en vez de inventarlo.`,
  },
};

const MAX_SNAPSHOT_CHARS = 8000; // ≈2KB de sobra sobre el ~1-2KB esperado; protege coste/latencia ante un snapshot anómalo

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Servidor no configurado (variables de entorno faltantes)' });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authErr } = await adminClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const { type, snapshot, question } = body;
  const typeConfig = AI_TYPES[type];
  if (!typeConfig) return res.status(400).json({ error: 'type inválido (alert|bulletin|query)' });
  if (!snapshot || typeof snapshot !== 'object') return res.status(400).json({ error: 'Falta snapshot' });
  if (type === 'query' && !question) return res.status(400).json({ error: 'Falta question' });

  const snapshotStr = JSON.stringify(snapshot);
  if (snapshotStr.length > MAX_SNAPSHOT_CHARS) {
    return res.status(413).json({ error: 'Snapshot demasiado grande' });
  }

  const userContent = type === 'query'
    ? `Pregunta del equipo: "${question}"\n\nDatos actuales de la carrera:\n${snapshotStr}`
    : `Datos actuales de la carrera:\n${snapshotStr}`;

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: typeConfig.model,
      max_tokens: typeConfig.maxTokens,
      // Sonnet 5 corre "thinking" adaptativo por defecto si no se especifica, y
      // max_tokens cuenta razonamiento + texto juntos — sin desactivarlo, el
      // boletín se cortaba a mitad de frase porque el pensamiento interno se
      // comía casi todo el presupuesto. Esta tarea es interpretación directa
      // de datos ya calculados, no necesita razonamiento multi-paso.
      thinking: { type: 'disabled' },
      system: typeConfig.systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = response.content.find(b => b.type === 'text')?.text || '';
    return res.json({ message: text });
  } catch (e) {
    console.error('[ai-engineer]', e.message);
    return res.status(502).json({ error: 'Error consultando la IA' });
  }
};
