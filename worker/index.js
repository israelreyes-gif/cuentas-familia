/**
 * Cloudflare Worker — API de "Cuentas de casa"
 * -----------------------------------------------------------------------
 * Endpoints:
 *   GET    /api/categorias            -> lista de categorías + gasto del mes en curso
 *   POST   /api/categorias            -> crear categoría          { nombre, color, presupuesto }
 *   PATCH  /api/categorias/:nombre    -> actualizar presupuesto   { presupuesto }
 *   DELETE /api/categorias/:nombre    -> eliminar categoría (con reasignación si tiene movimientos)
 *   GET    /api/movimientos           -> lista de movimientos (con nombre/color de categoría)
 *   POST   /api/movimientos           -> crear movimiento { descripcion, categoria, tipo, importe, fecha }
 *
 * Requiere un binding D1 llamado "DB" (Settings -> Bindings en el Worker).
 * -----------------------------------------------------------------------
 */

// Origen permitido para CORS: la URL de tu GitHub Pages.
// Cámbiala si tu usuario/repositorio son distintos.
const ALLOWED_ORIGIN = 'https://israelreyes-gif.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

    // preflight CORS
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ---- /api/categorias ----
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

      // ---- /api/movimientos ----
      if (path === '/api/movimientos' && method === 'GET') {
        return await getMovimientos(env);
      }
      if (path === '/api/movimientos' && method === 'POST') {
        return await createMovimiento(request, env);
      }

      return error('Ruta no encontrada', 404);
    } catch (err) {
      return error('Error interno: ' + err.message, 500);
    }
  },
};

// ---------------------------------------------------------------------
// categorías
// ---------------------------------------------------------------------

async function getCategorias(env) {
  const { results } = await env.DB.prepare(`
    SELECT
      c.nombre,
      c.color,
      c.presupuesto,
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

  if (!nombre) return error('El nombre es obligatorio');

  try {
    await env.DB.prepare(
      'INSERT INTO categorias (nombre, color, presupuesto) VALUES (?, ?, ?)'
    ).bind(nombre, color, presupuesto).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return error('Ya existe una categoría con ese nombre', 409);
    }
    throw err;
  }

  return json({ nombre, color, presupuesto, gastado: 0, movimientos: 0 }, 201);
}

async function updateCategoria(nombre, request, env) {
  const body = await request.json();
  const presupuesto = Math.max(0, Number(body.presupuesto) || 0);

  const result = await env.DB.prepare(
    'UPDATE categorias SET presupuesto = ? WHERE nombre = ?'
  ).bind(presupuesto, nombre).run();

  if (result.meta.changes === 0) return error('Categoría no encontrada', 404);
  return json({ nombre, presupuesto });
}

/**
 * Borra una categoría.
 * - Si no tiene movimientos, se borra directamente.
 * - Si tiene movimientos y no se indica `reassignTo` en el body, NO se borra:
 *   se devuelve un 409 pidiendo a qué categoría reasignarlos.
 * - Si se indica `reassignTo`, se mueven todos sus movimientos a esa
 *   categoría y, solo entonces, se borra la original.
 */
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
    } catch (_) {
      // sin cuerpo (o cuerpo vacío): seguimos sin reassignTo, se pedirá abajo
    }

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
