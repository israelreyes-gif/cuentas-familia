/**
 * Cloudflare Worker — API de "Cuentas de casa"
 * -----------------------------------------------------------------------
 * Endpoints públicos (sin token):
 *   POST   /api/auth/registro
 *   POST   /api/auth/login
 *
 * Endpoints protegidos (requieren cabecera Authorization: Bearer <token>):
 *   GET    /api/categorias
 *   POST   /api/categorias
 *   PATCH  /api/categorias/:nombre
 *   DELETE /api/categorias/:nombre
 *   GET    /api/movimientos
 *   POST   /api/movimientos
 *   DELETE /api/movimientos/:id
 *   POST   /api/push/subscribe        -> guarda la suscripción push del dispositivo
 *
 * Tareas programadas (cron, ver wrangler.toml), ambas el día 1 de cada mes:
 *   03:00 UTC -> genera los gastos fijos del mes
 *   06:00 UTC -> envía notificación push recordando registrar la nómina
 *
 * Requiere:
 *   - binding D1 llamado "DB"
 *   - variable VAPID_PUBLIC_KEY
 *   - variable VAPID_SUBJECT (formato mailto:tu-email@ejemplo.com)
 *   - variable cifrada VAPID_PRIVATE_KEY
 * -----------------------------------------------------------------------
 */

const ALLOWED_ORIGIN = 'https://israelreyes-gif.github.io';
const SESSION_DAYS = 7;
const DESC_GASTO_FIJO = 'Gasto fijo mensual';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === '/api/auth/registro' && method === 'POST') {
        return await registro(request, env);
      }
      if (path === '/api/auth/login' && method === 'POST') {
        return await login(request, env);
      }

      const auth = await requireAuth(request, env);
      if (!auth.ok) return auth.response;

      if (path === '/api/categorias' && method === 'GET') {
        return await getCategorias(env);
      }
      if (path === '/api/categorias' && method === 'POST') {
        return await createCategoria(request, env);
      }
      const catMatch = path.match(/^\/api\/categorias\/([^/]+)$/);
      if (catMatch && method === 'PATCH') {
        return await updateCategoria(decodeURIComponent(catMatch[1]), request, env);
      }
      if (catMatch && method === 'DELETE') {
        return await deleteCategoria(decodeURIComponent(catMatch[1]), request, env);
      }

      if (path === '/api/movimientos' && method === 'GET') {
        return await getMovimientos(env);
      }
      if (path === '/api/movimientos' && method === 'POST') {
        return await createMovimiento(request, env);
      }
      const movMatch = path.match(/^\/api\/movimientos\/(\d+)$/);
      if (movMatch && method === 'DELETE') {
        return await deleteMovimiento(Number(movMatch[1]), env);
      }

      if (path === '/api/push/subscribe' && method === 'POST') {
        return await pushSubscribe(request, env);
      }

      return error('Ruta no encontrada', 404);
    } catch (err) {
      return error('Error interno: ' + err.message, 500);
    }
  },

  /** Se dispara según el horario definido en wrangler.toml. event.cron indica cuál de los dos. */
  async scheduled(event, env, ctx) {
    if (event.cron === '0 3 1 * *') {
      ctx.waitUntil(generarGastosFijos(env));
    } else if (event.cron === '0 6 1 * *') {
      ctx.waitUntil(enviarAvisoNomina(env));
    }
  },
};

// ---------------------------------------------------------------------
// gastos fijos automáticos
// ---------------------------------------------------------------------

async function generarGastosFijos(env) {
  const hoy = new Date();
  const primerDiaMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const { results: fijas } = await env.DB.prepare(
    'SELECT id, presupuesto FROM categorias WHERE fija = 1 AND presupuesto > 0'
  ).all();

  let creados = 0;
  for (const cat of fijas) {
    const yaExiste = await env.DB.prepare(
      'SELECT id FROM movimientos WHERE categoria_id = ? AND fecha = ? AND descripcion = ?'
    ).bind(cat.id, primerDiaMes, DESC_GASTO_FIJO).first();

    if (yaExiste) continue;

    await env.DB.prepare(
      "INSERT INTO movimientos (descripcion, categoria_id, tipo, importe, fecha) VALUES (?, ?, 'expense', ?, ?)"
    ).bind(DESC_GASTO_FIJO, cat.id, cat.presupuesto, primerDiaMes).run();
    creados++;
  }

  return creados;
}

// ---------------------------------------------------------------------
// notificaciones push
// ---------------------------------------------------------------------

async function pushSubscribe(request, env) {
  const body = await request.json();
  const sub = body && body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return error('Suscripción push inválida');
  }

  await env.DB.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth).run();

  return json({ ok: true });
}

async function enviarAvisoNomina(env) {
  const { results: subs } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions').all();

  const payload = JSON.stringify({
    title: 'Cuentas de casa',
    body: 'Ya es día 1 — no olvides registrar la nómina de este mes.',
  });

  let enviados = 0;
  for (const sub of subs) {
    try {
      await sendWebPush(sub, payload, env);
      enviados++;
    } catch (err) {
      if (err.status === 404 || err.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
      }
    }
  }
  return enviados;
}

// ---- criptografía Web Push (VAPID + cifrado aes128gcm), sin librerías externas ----

function b64urlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function importVapidPrivateKey(privateKeyB64url, publicKeyB64url) {
  const pub = b64urlDecode(publicKeyB64url); // 65 bytes: 0x04 || x(32) || y(32)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64urlEncode(x), y: b64urlEncode(y), d: privateKeyB64url,
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** El "subject" (env.VAPID_SUBJECT) identifica quién envía, con un email de contacto: mailto:... */
async function createVapidJwt(privateKey, audience, subject) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const enc = new TextEncoder();
  const signingInput =
    b64urlEncode(enc.encode(JSON.stringify(header))) + '.' + b64urlEncode(enc.encode(JSON.stringify(claims)));

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(signingInput)
  );
  return signingInput + '.' + b64urlEncode(new Uint8Array(signature));
}

/** Cifra el contenido de la notificación según RFC 8291 (aes128gcm). */
async function encryptPayload(payloadText, p256dhB64url, authB64url) {
  const enc = new TextEncoder();
  const uaPublic = b64urlDecode(p256dhB64url);
  const authSecret = b64urlDecode(authB64url);

  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));

  const subscriberPublicKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: subscriberPublicKey }, serverKeyPair.privateKey, 256)
  );

  async function hmacSha256(keyBytes, dataBytes) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
  }

  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublicRaw);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);

  const cekInfo = enc.encode('Content-Encoding: aes128gcm\0');
  const cek = (await hmacSha256(prk, concatBytes(cekInfo, new Uint8Array([1])))).slice(0, 16);

  const nonceInfo = enc.encode('Content-Encoding: nonce\0');
  const nonce = (await hmacSha256(prk, concatBytes(nonceInfo, new Uint8Array([1])))).slice(0, 12);

  const plaintext = concatBytes(enc.encode(payloadText), new Uint8Array([2])); // 0x02 = delimitador, sin padding extra

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext)
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

async function sendWebPush(sub, payloadText, env) {
  const endpointUrl = new URL(sub.endpoint);
  const audience = endpointUrl.origin;

  const privateKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  const jwt = await createVapidJwt(privateKey, audience, env.VAPID_SUBJECT);
  const body = await encryptPayload(payloadText, sub.p256dh, sub.auth);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });

  if (!res.ok) {
    const err = new Error('Push service respondió ' + res.status);
    err.status = res.status;
    throw err;
  }
}

// ---------------------------------------------------------------------
// autenticación
// ---------------------------------------------------------------------

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return { saltHex: bytesToHex(salt), hashHex: bytesToHex(new Uint8Array(bits)) };
}

async function registro(request, env) {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) return error('Usuario y contraseña son obligatorios');
  if (password.length < 6) return error('La contraseña debe tener al menos 6 caracteres');

  const { count } = await env.DB.prepare('SELECT COUNT(*) as count FROM usuarios').first();
  if (count > 0) return error('Ya existe una cuenta. No se permiten más registros.', 403);

  const { saltHex, hashHex } = await hashPassword(password);

  try {
    await env.DB.prepare('INSERT INTO usuarios (username, password_salt, password_hash) VALUES (?, ?, ?)')
      .bind(username, saltHex, hashHex).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return error('Ese nombre de usuario ya existe', 409);
    }
    throw err;
  }

  return json({ ok: true, message: 'Cuenta creada correctamente.' }, 201);
}

async function login(request, env) {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) return error('Usuario y contraseña son obligatorios');

  const user = await env.DB.prepare('SELECT id, password_salt, password_hash FROM usuarios WHERE username = ?')
    .bind(username).first();
  if (!user) return error('Usuario o contraseña incorrectos', 401);

  const { hashHex } = await hashPassword(password, user.password_salt);
  if (hashHex !== user.password_hash) return error('Usuario o contraseña incorrectos', 401);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare('INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, user.id, expiresAt).run();

  return json({ token });
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: error('No autenticado', 401) };

  const session = await env.DB.prepare('SELECT usuario_id, expires_at FROM sesiones WHERE token = ?')
    .bind(token).first();
  if (!session) return { ok: false, response: error('Sesión no válida', 401) };

  if (new Date(session.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sesiones WHERE token = ?').bind(token).run();
    return { ok: false, response: error('Sesión caducada', 401) };
  }

  const nuevaExpiracion = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('UPDATE sesiones SET expires_at = ? WHERE token = ?').bind(nuevaExpiracion, token).run();

  return { ok: true };
}

// ---------------------------------------------------------------------
// categorías
// ---------------------------------------------------------------------

async function getCategorias(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      c.nombre,
      c.color,
      c.presupuesto,
      c.fija,
      COALESCE(SUM(CASE
        WHEN m.tipo = 'expense' AND strftime('%Y-%m', m.fecha) = strftime('%Y-%m','now')
        THEN m.importe ELSE 0
      END), 0) AS gastado,
      COUNT(CASE
        WHEN strftime('%Y-%m', m.fecha) = strftime('%Y-%m','now')
        THEN m.id
      END) AS movimientos
    FROM categorias c
    LEFT JOIN movimientos m ON m.categoria_id = c.id
    GROUP BY c.id
    ORDER BY c.nombre COLLATE NOCASE
  `).all();

  return json(results);
}

async function createCategoria(request, env) {
  const body = await request.json();
  const nombre = (body.nombre || '').trim();
  const color = body.color || '#B7912B';
  const presupuesto = Math.max(0, Number(body.presupuesto) || 0);
  const fija = body.fija ? 1 : 0;

  if (!nombre) return error('El nombre es obligatorio');

  try {
    await env.DB.prepare(
      'INSERT INTO categorias (nombre, color, presupuesto, fija) VALUES (?, ?, ?, ?)'
    ).bind(nombre, color, presupuesto, fija).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return error('Ya existe una categoría con ese nombre', 409);
    }
    throw err;
  }

  return json({ nombre, color, presupuesto, fija, gastado: 0, movimientos: 0 }, 201);
}

async function updateCategoria(nombre, request, env) {
  const body = await request.json();
  const sets = [];
  const binds = [];

  if (body.presupuesto !== undefined) {
    sets.push('presupuesto = ?');
    binds.push(Math.max(0, Number(body.presupuesto) || 0));
  }
  if (body.fija !== undefined) {
    sets.push('fija = ?');
    binds.push(body.fija ? 1 : 0);
  }
  if (sets.length === 0) return error('Nada que actualizar');

  binds.push(nombre);
  const result = await env.DB.prepare(`UPDATE categorias SET ${sets.join(', ')} WHERE nombre = ?`)
    .bind(...binds).run();
  if (result.meta.changes === 0) return error('Categoría no encontrada', 404);

  const actualizado = await env.DB.prepare('SELECT nombre, presupuesto, fija FROM categorias WHERE nombre = ?')
    .bind(nombre).first();
  return json(actualizado);
}

async function deleteCategoria(nombre, request, env) {
  const cat = await env.DB.prepare('SELECT id FROM categorias WHERE nombre = ?')
    .bind(nombre).first();
  if (!cat) return error('Categoría no encontrada', 404);

  const { count } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM movimientos WHERE categoria_id = ?'
  ).bind(cat.id).first();

  if (count > 0) {
    let reassignTo = null;
    try {
      const body = await request.json();
      reassignTo = body && body.reassignTo ? String(body.reassignTo).trim() : null;
    } catch (_) {}

    if (!reassignTo) {
      return json({
        error: 'tiene_movimientos',
        count,
        message: `Esta categoría tiene ${count} movimiento(s). Indica a qué categoría reasignarlos.`,
      }, 409);
    }

    if (reassignTo === nombre) {
      return error('La categoría de destino tiene que ser distinta de la que borras', 400);
    }

    const destino = await env.DB.prepare('SELECT id FROM categorias WHERE nombre = ?')
      .bind(reassignTo).first();
    if (!destino) return error('La categoría de destino no existe', 404);

    await env.DB.prepare('UPDATE movimientos SET categoria_id = ? WHERE categoria_id = ?')
      .bind(destino.id, cat.id).run();
  }

  await env.DB.prepare('DELETE FROM categorias WHERE id = ?').bind(cat.id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// movimientos
// ---------------------------------------------------------------------

async function getMovimientos(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      m.id,
      m.descripcion AS desc,
      c.nombre AS cat,
      m.tipo,
      m.importe,
      m.fecha
    FROM movimientos m
    JOIN categorias c ON c.id = m.categoria_id
    ORDER BY m.fecha DESC, m.id DESC
  `).all();

  return json(results);
}

async function createMovimiento(request, env) {
  const body = await request.json();
  const descripcion = (body.descripcion || '').trim();
  const categoria = (body.categoria || '').trim();
  const tipo = body.tipo === 'income' ? 'income' : 'expense';
  const importe = Number(body.importe);
  const fecha = body.fecha || new Date().toISOString().slice(0, 10);

  if (!descripcion) return error('La descripción es obligatoria');
  if (!categoria) return error('La categoría es obligatoria');
  if (!importe || importe <= 0) return error('El importe debe ser mayor que 0');

  const cat = await env.DB.prepare('SELECT id FROM categorias WHERE nombre = ?')
    .bind(categoria).first();
  if (!cat) return error('La categoría indicada no existe', 404);

  const result = await env.DB.prepare(
    'INSERT INTO movimientos (descripcion, categoria_id, tipo, importe, fecha) VALUES (?, ?, ?, ?, ?)'
  ).bind(descripcion, cat.id, tipo, importe, fecha).run();

  return json({
    id: result.meta.last_row_id,
    desc: descripcion,
    cat: categoria,
    tipo,
    importe,
    fecha,
  }, 201);
}

async function deleteMovimiento(id, env) {
  const result = await env.DB.prepare('DELETE FROM movimientos WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return error('Movimiento no encontrado', 404);
  return json({ ok: true });
}
