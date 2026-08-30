/**
 * Cloudflare Worker — API de "Cuentas de casa"
 * -----------------------------------------------------------------------
 * ⚠️ ESTE WORKER YA NO RECIBE TRÁFICO DE LA APP (la API vive ahora en
 * Deno Deploy). Se mantiene solo por si hace falta consultarlo mientras
 * se termina de confirmar que todo funciona bien en Deno. Se borrará en
 * la limpieza final de Cloudflare.
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

  async scheduled(event, env, ctx) {
    if (event.cron === '0 3 1 * *') {
      ctx.waitUntil(generarGastosFijos(env));
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
