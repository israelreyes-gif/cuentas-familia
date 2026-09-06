/**
 * Cloudflare Worker — API de "Cuentas de casa"
 * -----------------------------------------------------------------------
 * Incluye login, categorías, movimientos, gastos fijos automáticos,
 * y el saldo inicial (config) para calcular el saldo acumulado real
 * de la cuenta, no solo el del mes en curso.
 * -----------------------------------------------------------------------
 */

const ALLOWED_ORIGIN = 'https://israelreyes-gif.github.io';
const SESSION_DAYS = 7;
const DESC_GASTO_FIJO = 'Gasto fijo';

/** recurrencia (texto guardado en D1) → cada cuántos meses se repite */
const RECURRENCIA_MESES = {
  mensual: 1,
  bimestral: 2,
  trimestral: 3,
  cuatrimestral: 4,
  semestral: 6,
  anual: 12,
};

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

      if (path === '/api/config' && method === 'GET') {
        return await getConfig(env);
      }

      if (path === '/api/categorias' && method === 'GET') {
        return await getCategorias(env);
      }
      if (path === '/api/categorias' && method === 'POST') {
        return await createCategoria(request, env);
      }
      const catMatch = path.match(/^\/api\/categorias\/(\d+)$/);
      if (catMatch && method === 'PATCH') {
        return await updateCategoria(Number(catMatch[1]), request, env);
      }
      if (catMatch && method === 'DELETE') {
        return await deleteCategoria(Number(catMatch[1]), request, env);
      }

      if (path === '/api/movimientos' && method === 'GET') {
        return await getMovimientos(env);
      }
      if (path === '/api/movimientos/rango' && method === 'GET') {
        return await getMovimientosRango(url.searchParams.get('hasta'), env);
      }
      if (path === '/api/movimientos/primera-fecha' && method === 'GET') {
        return await getPrimeraFecha(env);
      }
      if (path === '/api/movimientos/buscar' && method === 'GET') {
        return await buscarMovimientos(url.searchParams, env);
      }
      if (path === '/api/movimientos' && method === 'POST') {
        return await createMovimiento(request, env);
      }
      const movMatch = path.match(/^\/api\/movimientos\/(\d+)$/);
      if (movMatch && method === 'DELETE') {
        return await deleteMovimiento(Number(movMatch[1]), env);
      }

      return error('Ruta no encontrada', 404);
    } catch (err) {
      console.error('Error interno:', err.message, err.stack);
      return error('Ha ocurrido un error. Inténtalo de nuevo.', 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 3 1 * *') {
      ctx.waitUntil((async () => {
        await cerrarMesAnterior(env);
        await generarGastosFijos(env);
      })());
    }
  },
};

// ---------------------------------------------------------------------
// configuración (saldo inicial)
// ---------------------------------------------------------------------

async function getConfig(env) {
  const row = await env.DB.prepare("SELECT valor, actualizado_en FROM config WHERE clave = 'saldo_inicial'").first();
  return json({
    saldo_inicial: row ? Number(row.valor) : 0,
    saldo_actualizado_en: row ? row.actualizado_en : null,
  });
}

// ---------------------------------------------------------------------
// gastos fijos automáticos
// ---------------------------------------------------------------------

/**
 * Cada día 1, antes de generar los gastos fijos del mes nuevo, "cierra"
 * el mes que acaba de terminar: suma su efecto neto (ingresos - gastos)
 * al saldo_inicial guardado en config, para que ese saldo represente
 * siempre "lo que había al empezar el mes en curso". Así el frontend
 * solo necesita traer los movimientos del mes actual para calcular el
 * saldo, en vez de todo el histórico.
 */
async function cerrarMesAnterior(env) {
  const hoy = new Date();
  const inicioMesAnterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const inicioMesActual = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const { neto } = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN tipo = 'expense' THEN -importe ELSE importe END), 0) AS neto
    FROM movimientos
    WHERE fecha >= ? AND fecha < ?
  `).bind(inicioMesAnterior, inicioMesActual).first();

  const row = await env.DB.prepare("SELECT valor FROM config WHERE clave = 'saldo_inicial'").first();
  const saldoActual = row ? Number(row.valor) : 0;
  const nuevoSaldo = saldoActual + neto;

  await env.DB.prepare(`
    INSERT INTO config (clave, valor, actualizado_en) VALUES ('saldo_inicial', ?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en
  `).bind(String(nuevoSaldo), new Date().toISOString()).run();
}

async function generarGastosFijos(env) {
  const hoy = new Date();
  const mesActual = hoy.getUTCMonth() + 1; // 1 = enero ... 12 = diciembre
  const primerDiaMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const { results: fijas } = await env.DB.prepare(
    'SELECT id, presupuesto, recurrencia, mes_inicio FROM categorias WHERE fija = 1 AND presupuesto > 0'
  ).all();

  let creados = 0;
  for (const cat of fijas) {
    if (!tocaEsteMes(cat, mesActual)) continue;

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

/**
 * Decide si a una categoría fija "le toca" generarse en el mes dado,
 * según su mes de inicio y su recurrencia (mensual, bimestral... anual).
 * Como todos los intervalos (1,2,3,4,6,12) dividen exactamente a 12,
 * el ciclo se repite igual todos los años sin arrastrar desfases.
 */
function tocaEsteMes(cat, mesActual) {
  const intervalo = RECURRENCIA_MESES[cat.recurrencia] || 1;
  const mesInicio = cat.mes_inicio || 1;
  const diff = ((mesActual - mesInicio) % 12 + 12) % 12;
  return diff % intervalo === 0;
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

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  const mensajeBloqueo = await checkBloqueoLogin(ip, env);
  if (mensajeBloqueo) return error(mensajeBloqueo, 429);

  const user = await env.DB.prepare('SELECT id, password_salt, password_hash FROM usuarios WHERE username = ?')
    .bind(username).first();

  const credencialesValidas = user
    ? (await hashPassword(password, user.password_salt)).hashHex === user.password_hash
    : false;

  if (!credencialesValidas) {
    await registrarIntentoFallido(ip, env);
    return error('Usuario o contraseña incorrectos', 401);
  }

  await limpiarIntentosLogin(ip, env);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare('INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, user.id, expiresAt).run();

  return json({ token });
}

/**
 * Rate-limit de login por IP: 5 intentos fallidos en 5 minutos bloquean
 * 30 minutos. Un login correcto resetea el contador de esa IP.
 */
const LOGIN_MAX_INTENTOS = 5;
const LOGIN_VENTANA_MIN = 5;
const LOGIN_BLOQUEO_MIN = 30;

async function checkBloqueoLogin(ip, env) {
  const row = await env.DB.prepare('SELECT bloqueado_hasta FROM intentos_login WHERE ip = ?').bind(ip).first();
  if (!row || !row.bloqueado_hasta) return null;

  const bloqueadoHasta = new Date(row.bloqueado_hasta);
  if (bloqueadoHasta <= new Date()) return null;

  const minutosRestantes = Math.max(1, Math.ceil((bloqueadoHasta - new Date()) / 60000));
  return `Demasiados intentos fallidos. Inténtalo de nuevo en ${minutosRestantes} minuto(s).`;
}

async function registrarIntentoFallido(ip, env) {
  const ahora = new Date();
  const row = await env.DB.prepare('SELECT intentos, primer_intento FROM intentos_login WHERE ip = ?').bind(ip).first();

  const ventanaExpirada = !row || (ahora - new Date(row.primer_intento)) > LOGIN_VENTANA_MIN * 60 * 1000;

  const intentos = ventanaExpirada ? 1 : row.intentos + 1;
  const primerIntento = ventanaExpirada ? ahora.toISOString() : row.primer_intento;
  const bloqueadoHasta = intentos >= LOGIN_MAX_INTENTOS
    ? new Date(ahora.getTime() + LOGIN_BLOQUEO_MIN * 60 * 1000).toISOString()
    : null;

  await env.DB.prepare(`
    INSERT INTO intentos_login (ip, intentos, primer_intento, bloqueado_hasta) VALUES (?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET intentos = excluded.intentos, primer_intento = excluded.primer_intento, bloqueado_hasta = excluded.bloqueado_hasta
  `).bind(ip, intentos, primerIntento, bloqueadoHasta).run();
}

async function limpiarIntentosLogin(ip, env) {
  await env.DB.prepare('DELETE FROM intentos_login WHERE ip = ?').bind(ip).run();
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
      c.id,
      c.nombre,
      c.presupuesto,
      c.fija,
      c.recurrencia,
      c.mes_inicio,
      COALESCE(SUM(CASE
        WHEN strftime('%Y-%m', m.fecha) != strftime('%Y-%m','now') THEN 0
        WHEN m.tipo = 'expense' THEN m.importe
        ELSE -m.importe
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
  const presupuesto = Math.max(0, Number(body.presupuesto) || 0);
  const fija = body.fija ? 1 : 0;

  if (!nombre) return error('El nombre es obligatorio');

  const recurrencia = validarRecurrencia(body.recurrencia);
  if (recurrencia === null) return error('Recurrencia no válida');

  const mesInicio = validarMesInicio(body.mes_inicio);
  if (mesInicio === null) return error('Mes de inicio no válido (debe ser 1-12)');

  try {
    const result = await env.DB.prepare(
      'INSERT INTO categorias (nombre, presupuesto, fija, recurrencia, mes_inicio) VALUES (?, ?, ?, ?, ?)'
    ).bind(nombre, presupuesto, fija, recurrencia, mesInicio).run();

    return json({
      id: result.meta.last_row_id,
      nombre, presupuesto, fija, recurrencia, mes_inicio: mesInicio, gastado: 0, movimientos: 0,
    }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return error('Ya existe una categoría con ese nombre', 409);
    }
    throw err;
  }
}

/** Devuelve la recurrencia validada, o 'mensual' si no viene, o null si es inválida */
function validarRecurrencia(valor) {
  if (valor === undefined || valor === null || valor === '') return 'mensual';
  return Object.prototype.hasOwnProperty.call(RECURRENCIA_MESES, valor) ? valor : null;
}

/** Devuelve el mes de inicio validado (1-12), o 1 si no viene, o null si es inválido */
function validarMesInicio(valor) {
  if (valor === undefined || valor === null || valor === '') return 1;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

async function updateCategoria(id, request, env) {
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
  if (body.recurrencia !== undefined) {
    const recurrencia = validarRecurrencia(body.recurrencia);
    if (recurrencia === null) return error('Recurrencia no válida');
    sets.push('recurrencia = ?');
    binds.push(recurrencia);
  }
  if (body.mes_inicio !== undefined) {
    const mesInicio = validarMesInicio(body.mes_inicio);
    if (mesInicio === null) return error('Mes de inicio no válido (debe ser 1-12)');
    sets.push('mes_inicio = ?');
    binds.push(mesInicio);
  }
  if (sets.length === 0) return error('Nada que actualizar');

  binds.push(id);
  const result = await env.DB.prepare(`UPDATE categorias SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds).run();
  if (result.meta.changes === 0) return error('Categoría no encontrada', 404);

  const actualizado = await env.DB.prepare(
    'SELECT id, nombre, presupuesto, fija, recurrencia, mes_inicio FROM categorias WHERE id = ?'
  ).bind(id).first();
  return json(actualizado);
}

async function deleteCategoria(id, request, env) {
  const cat = await env.DB.prepare('SELECT id, nombre FROM categorias WHERE id = ?')
    .bind(id).first();
  if (!cat) return error('Categoría no encontrada', 404);

  const { count } = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM movimientos WHERE categoria_id = ?'
  ).bind(cat.id).first();

  if (count > 0) {
    let reassignTo = null;
    try {
      const body = await request.json();
      reassignTo = body && body.reassignTo ? Number(body.reassignTo) : null;
    } catch (_) {}

    if (!reassignTo) {
      return json({
        error: 'tiene_movimientos',
        count,
        message: `Esta categoría tiene ${count} movimiento(s). Indica a qué categoría reasignarlos.`,
      }, 409);
    }

    if (reassignTo === cat.id) {
      return error('La categoría de destino tiene que ser distinta de la que borras', 400);
    }

    const destino = await env.DB.prepare('SELECT id FROM categorias WHERE id = ?')
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
    WHERE strftime('%Y-%m', m.fecha) = strftime('%Y-%m','now')
    ORDER BY m.fecha DESC, m.id DESC
  `).all();

  return json(results);
}

/**
 * Movimientos de una ventana de 12 meses que termina en el mes "hasta"
 * (formato 'YYYY-MM'). Se usa solo para la Gráfica, que necesita
 * histórico más allá del mes en curso.
 */
async function getMovimientosRango(hastaParam, env) {
  const hoy = new Date();
  const hasta = hastaParam && /^\d{4}-\d{2}$/.test(hastaParam)
    ? hastaParam
    : `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}`;

  const [anioHasta, mesHasta] = hasta.split('-').map(Number);

  // Fin de la ventana: primer día del mes siguiente al "hasta" (exclusivo).
  const fin = new Date(Date.UTC(anioHasta, mesHasta, 1)).toISOString().slice(0, 10);
  // Inicio de la ventana: primer día de 11 meses antes del mes "hasta".
  const inicio = new Date(Date.UTC(anioHasta, mesHasta - 1 - 11, 1)).toISOString().slice(0, 10);

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
    WHERE m.fecha >= ? AND m.fecha < ?
    ORDER BY m.fecha ASC, m.id ASC
  `).bind(inicio, fin).all();

  return json(results);
}

/** Fecha del movimiento más antiguo registrado, para saber hasta dónde se puede retroceder en la Gráfica. */
async function getPrimeraFecha(env) {
  const row = await env.DB.prepare('SELECT MIN(fecha) AS fecha FROM movimientos').first();
  return json({ fecha: row ? row.fecha : null });
}

/**
 * Buscador: filtra por texto (descripción), categoría, tipo y rango de
 * fechas — en todo el histórico, no solo el mes en curso. Máximo 100
 * resultados, del más reciente al más antiguo.
 */
async function buscarMovimientos(params, env) {
  const texto = (params.get('texto') || '').trim();
  const categoriaId = params.get('categoria_id');
  const tipo = params.get('tipo');
  const desde = params.get('desde');
  const hasta = params.get('hasta');

  const condiciones = [];
  const binds = [];

  if (texto) {
    condiciones.push('m.descripcion LIKE ?');
    binds.push(`%${texto}%`);
  }
  if (categoriaId) {
    condiciones.push('m.categoria_id = ?');
    binds.push(Number(categoriaId));
  }
  if (tipo === 'expense' || tipo === 'income') {
    condiciones.push('m.tipo = ?');
    binds.push(tipo);
  }
  if (desde) {
    condiciones.push('m.fecha >= ?');
    binds.push(desde);
  }
  if (hasta) {
    condiciones.push('m.fecha <= ?');
    binds.push(hasta);
  }

  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';

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
    ${where}
    ORDER BY m.fecha DESC, m.id DESC
    LIMIT 100
  `).bind(...binds).all();

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
