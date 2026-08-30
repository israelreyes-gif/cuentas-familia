/**
 * api/[...path].js
 * -----------------------------------------------------------------------
 * API de "Cuentas de casa" corriendo en Vercel (Edge Function) en vez de
 * en Cloudflare Workers. La lógica de negocio es la misma que ya tenías
 * en worker/index.js — lo único que cambia es CÓMO se habla con D1:
 * en vez del acceso directo "env.DB" (que solo existe dentro de
 * Cloudflare), aquí se usa la API HTTP pública de D1, envuelta en un
 * pequeño "puente" (ver dbFromEnv) que se comporta exactamente igual
 * (.prepare().bind().all()/.first()/.run()), para que el resto del
 * código sea idéntico al de Cloudflare.
 *
 * NOTA: esta primera versión NO incluye todavía el envío de
 * notificaciones push por cron (eso depende de configurar tareas
 * programadas en Vercel, que se hará en un paso aparte) — sí incluye
 * login, categorías, movimientos, y guardar/borrar suscripciones push.
 * -----------------------------------------------------------------------
 */

export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://israelreyes-gif.github.io';
const SESSION_DAYS = 7;

// ---------------------------------------------------------------------
// "puente" hacia D1: imita la forma de env.DB.prepare()... de Cloudflare
// ---------------------------------------------------------------------

function dbFromEnv() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${process.env.CF_D1_DATABASE_ID}/query`;

  async function execute(sql, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      },
      body: JSON.stringify({ sql, params }),
    });
    const data = await res.json();
    if (!data.success) {
      const msg = (data.errors && data.errors[0] && data.errors[0].message) || 'Error al consultar D1';
      throw new Error(msg);
    }
    return data.result[0]; // { results, meta, success }
  }

  return {
    prepare(sql) {
      let boundParams = [];
      const stmt = {
        bind(...params) {
          boundParams = params;
          return stmt;
        },
        async all() {
          const r = await execute(sql, boundParams);
          return { results: r.results || [] };
        },
        async first() {
          const r = await execute(sql, boundParams);
          return r.results && r.results.length ? r.results[0] : null;
        },
        async run() {
          const r = await execute(sql, boundParams);
          return { meta: { changes: r.meta.changes, last_row_id: r.meta.last_row_id } };
        },
      };
      return stmt;
    },
  };
}

// ---------------------------------------------------------------------
// helpers de respuesta
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// punto de entrada
// ---------------------------------------------------------------------

export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  const db = dbFromEnv();

  try {
    if (path === '/api/auth/registro' && method === 'POST') {
      return await registro(request, db);
    }
    if (path === '/api/auth/login' && method === 'POST') {
      return await login(request, db);
    }

    const auth = await requireAuth(request, db);
    if (!auth.ok) return auth.response;

    if (path === '/api/categorias' && method === 'GET') {
      return await getCategorias(db);
    }
    if (path === '/api/categorias' && method === 'POST') {
      return await createCategoria(request, db);
    }
    const catMatch = path.match(/^\/api\/categorias\/([^/]+)$/);
    if (catMatch && method === 'PATCH') {
      return await updateCategoria(decodeURIComponent(catMatch[1]), request, db);
    }
    if (catMatch && method === 'DELETE') {
      return await deleteCategoria(decodeURIComponent(catMatch[1]), request, db);
    }

    if (path === '/api/movimientos' && method === 'GET') {
      return await getMovimientos(db);
    }
    if (path === '/api/movimientos' && method === 'POST') {
      return await createMovimiento(request, db);
    }
    const movMatch = path.match(/^\/api\/movimientos\/(\d+)$/);
    if (movMatch && method === 'DELETE') {
      return await deleteMovimiento(Number(movMatch[1]), db);
    }

    if (path === '/api/push/subscribe' && method === 'POST') {
      return await pushSubscribe(request, db);
    }
    if (path === '/api/push/unsubscribe' && method === 'POST') {
      return await pushUnsubscribe(request, db);
    }

    return error('Ruta no encontrada', 404);
  } catch (err) {
    return error('Error interno: ' + err.message, 500);
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

async function registro(request, db) {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) return error('Usuario y contraseña son obligatorios');
  if (password.length < 6) return error('La contraseña debe tener al menos 6 caracteres');

  const { count } = await db.prepare('SELECT COUNT(*) as count FROM usuarios').first();
  if (count > 0) return error('Ya existe una cuenta. No se permiten más registros.', 403);

  const { saltHex, hashHex } = await hashPassword(password);

  try {
    await db.prepare('INSERT INTO usuarios (username, password_salt, password_hash) VALUES (?, ?, ?)')
      .bind(username, saltHex, hashHex).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return error('Ese nombre de usuario ya existe', 409);
    }
    throw err;
  }

  return json({ ok: true, message: 'Cuenta creada correctamente.' }, 201);
}

async function login(request, db) {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) return error('Usuario y contraseña son obligatorios');

  const user = await db.prepare('SELECT id, password_salt, password_hash FROM usuarios WHERE username = ?')
    .bind(username).first();
  if (!user) return error('Usuario o contraseña incorrectos', 401);

  const { hashHex } = await hashPassword(password, user.password_salt);
  if (hashHex !== user.password_hash) return error('Usuario o contraseña incorrectos', 401);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare('INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, user.id, expiresAt).run();

  return json({ token });
}

async function requireAuth(request, db) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: error('No autenticado', 401) };

  const session = await db.prepare('SELECT usuario_id, expires_at FROM sesiones WHERE token = ?')
    .bind(token).first();
  if (!session) return { ok: false, response: error('Sesión no válida', 401) };

  if (new Date(session.expires_at) < new Date()) {
    await db.prepare('DELETE FROM sesiones WHERE token = ?').bind(token).run();
    return { ok: false, response: error('Sesión caducada', 401) };
  }

  const nuevaExpiracion = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('UPDATE sesiones SET expires_at = ? WHERE token = ?').bind(nuevaExpiracion, token).run();

  return { ok: true };
}

// ---------------------------------------------------------------------
// categorías
// ---------------------------------------------------------------------

async function getCategorias(db) {
  const { results } = await db.prepare(`
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

async function createCategoria(request, db) {
  const body = await request.json();
  const nombre = (body.nombre || '').trim();
  const color = body.color || '#B7912B';
  const presupuesto = Math.max(0, Number(body.presupuesto) || 0);
  const fija = body.fija ? 1 : 0;

  if (!nombre) return error('El nombre es obligatorio');

  try {
    await db.prepare(
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

async function updateCategoria(nombre, request, db) {
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
  const result = await db.prepare(`UPDATE categorias SET ${sets.join(', ')} WHERE nombre = ?`)
    .bind(...binds).run();
  if (result.meta.changes === 0) return error('Categoría no encontrada', 404);

  const actualizado = await db.prepare('SELECT nombre, presupuesto, fija FROM categorias WHERE nombre = ?')
    .bind(nombre).first();
  return json(actualizado);
}

async function deleteCategoria(nombre, request, db) {
  const cat = await db.prepare('SELECT id FROM categorias WHERE nombre = ?')
    .bind(nombre).first();
  if (!cat) return error('Categoría no encontrada', 404);

  const { count } = await db.prepare(
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

    const destino = await db.prepare('SELECT id FROM categorias WHERE nombre = ?')
      .bind(reassignTo).first();
    if (!destino) return error('La categoría de destino no existe', 404);

    await db.prepare('UPDATE movimientos SET categoria_id = ? WHERE categoria_id = ?')
      .bind(destino.id, cat.id).run();
  }

  await db.prepare('DELETE FROM categorias WHERE id = ?').bind(cat.id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// movimientos
// ---------------------------------------------------------------------

async function getMovimientos(db) {
  const { results } = await db.prepare(`
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

async function createMovimiento(request, db) {
  const body = await request.json();
  const descripcion = (body.descripcion || '').trim();
  const categoria = (body.categoria || '').trim();
  const tipo = body.tipo === 'income' ? 'income' : 'expense';
  const importe = Number(body.importe);
  const fecha = body.fecha || new Date().toISOString().slice(0, 10);

  if (!descripcion) return error('La descripción es obligatoria');
  if (!categoria) return error('La categoría es obligatoria');
  if (!importe || importe <= 0) return error('El importe debe ser mayor que 0');

  const cat = await db.prepare('SELECT id FROM categorias WHERE nombre = ?')
    .bind(categoria).first();
  if (!cat) return error('La categoría indicada no existe', 404);

  const result = await db.prepare(
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

async function deleteMovimiento(id, db) {
  const result = await db.prepare('DELETE FROM movimientos WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return error('Movimiento no encontrado', 404);
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// notificaciones push (guardar/borrar suscripción — el ENVÍO por cron
// se añadirá en un paso aparte, cuando montemos las tareas programadas)
// ---------------------------------------------------------------------

async function pushSubscribe(request, db) {
  const body = await request.json();
  const sub = body && body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return error('Suscripción push inválida');
  }

  await db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth).run();

  return json({ ok: true });
}

async function pushUnsubscribe(request, db) {
  const body = await request.json();
  const endpoint = body && body.endpoint;
  if (!endpoint) return error('Falta el endpoint de la suscripción');

  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return json({ ok: true });
}
