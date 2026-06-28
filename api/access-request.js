export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, reason } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Faltan campos' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Email no configurado' });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'StintPro <onboarding@resend.dev>',
      to: 'bnh7dd9bzy@privaterelay.appleid.com',
      subject: 'Nueva solicitud de acceso — ' + name,
      html: `
        <p><strong>Nombre:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Motivo:</strong> ${reason || '(no especificado)'}</p>
      `
    })
  });

  if (!response.ok) {
    const err = await response.json();
    return res.status(500).json({ error: err.message || 'Error al enviar' });
  }

  res.status(200).json({ ok: true });
}
