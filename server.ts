/**
 * server.ts
 * -----------------------------------------------------------------------
 * API de "Cuentas de casa" corriendo en Deno Deploy en vez de en
 * Cloudflare Workers. Misma lógica de negocio que worker/index.js —
 * solo cambia CÓMO se habla con D1: en vez del acceso directo "env.DB"
 * (que solo existe dentro de Cloudflare), se usa la API HTTP pública de
 * D1, envuelta en un "puente" que se comporta igual (.prepare().bind()
 * .all()/.first()/.run()), para que el resto del código sea idéntico.
 * -----------------------------------------------------------------------
 */

const ALLOWED_ORIGIN = "https://israelreyes-gif.github.io";
const SESSION_DAYS = 7;

// ---------------------------------------------------------------------
// "puente" hacia D1
// ---------------------------------------------------------------------

function dbFromEnv() {
  const accountId = Deno.env.get("CF_ACCOUNT_ID");
  const databaseId = Deno.env.get("CF_D1_DATABASE_ID");
  const apiToken = Deno.env.get("CF_API_TOKEN");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  async function execute(sql: string, params: unknown[]) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ sql, params }),
    });
    const data = await res.json();
    if (!data.success) {
      const msg = data.errors?.[0]?.message || "Error al consultar D1";
      throw new Error(msg);
    }
    return data.result[0];
  }

  return {
    prepare(sql: string) {
      let boundParams: unknown[] = [];
      const stmt = {
        bind(...params: unknown[]) {
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
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

// ---------------------------------------------------------------------
// autenticación
// ---------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return { saltHex: bytesToHex(salt), hashHex: bytesToHex(new Uint8Array(bits)) };
}

async function registro(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const username = (body.username || "").trim();
  const password = body.password || "";

  if (!username || !password) return error("Usuario y contraseña son obligatorios");
  if (password.length < 6) return error("La contraseña debe tener al menos 6 caracteres");

  const { count } = await db.prepare("SELECT COUNT(*) as count FROM usuarios").first();
  if (count > 0) return error("Ya existe una cuenta. No se permiten más registros.", 403);

  const { saltHex, hashHex } = await hashPassword(password);

  try {
    await db.prepare("INSERT INTO usuarios (username, password_salt, password_hash) VALUES (?, ?, ?)")
      .bind(username, saltHex, hashHex).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return error("Ese nombre de usuario ya existe", 409);
    }
    throw err;
  }

  return json({ ok: true, message: "Cuenta creada correctamente." }, 201);
}

async function login(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const username = (body.username || "").trim();
  const password = body.password || "";

  if (!username || !password) return error("Usuario y contraseña son obligatorios");

  const user = await db.prepare("SELECT id, password_salt, password_hash FROM usuarios WHERE username = ?")
    .bind(username).first();
  if (!user) return error("Usuario o contraseña incorrectos", 401);

  const { hashHex } = await hashPassword(password, user.password_salt);
  if (hashHex !== user.password_hash) return error("Usuario o contraseña incorrectos", 401);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare("INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, user.id, expiresAt).run();

  return json({ token });
}

async function requireAuth(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: error("No autenticado", 401) };

  const session = await db.prepare("SELECT usuario_id, expires_at FROM sesiones WHERE token = ?")
    .bind(token).first();
  if (!session) return { ok: false, response: error("Sesión no válida", 401) };

  if (new Date(session.expires_at) < new Date()) {
    await db.prepare("DELETE FROM sesiones WHERE token = ?").bind(token).run();
    return { ok: false, response: error("Sesión caducada", 401) };
  }

  const nuevaExpiracion = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("UPDATE sesiones SET expires_at = ? WHERE token = ?").bind(nuevaExpiracion, token).run();

  return { ok: true };
}

// ---------------------------------------------------------------------
// categorías
// ---------------------------------------------------------------------

async function getCategorias(db: ReturnType<typeof dbFromEnv>) {
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

async function createCategoria(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const nombre = (body.nombre || "").trim();
  const color = body.color || "#B7912B";
  const presupuesto = Math.max(0, Number(body.presupuesto) || 0);
  const fija = body.fija ? 1 : 0;

  if (!nombre) return error("El nombre es obligatorio");

  try {
    await db.prepare(
      "INSERT INTO categorias (nombre, color, presupuesto, fija) VALUES (?, ?, ?, ?)"
    ).bind(nombre, color, presupuesto, fija).run();
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return error("Ya existe una categoría con ese nombre", 409);
    }
    throw err;
  }

  return json({ nombre, color, presupuesto, fija, gastado: 0, movimientos: 0 }, 201);
}

async function updateCategoria(nombre: string, request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.presupuesto !== undefined) {
    sets.push("presupuesto = ?");
    binds.push(Math.max(0, Number(body.presupuesto) || 0));
  }
  if (body.fija !== undefined) {
    sets.push("fija = ?");
    binds.push(body.fija ? 1 : 0);
  }
  if (sets.length === 0) return error("Nada que actualizar");

  binds.push(nombre);
  const result = await db.prepare(`UPDATE categorias SET ${sets.join(", ")} WHERE nombre = ?`)
    .bind(...binds).run();
  if (result.meta.changes === 0) return error("Categoría no encontrada", 404);

  const actualizado = await db.prepare("SELECT nombre, presupuesto, fija FROM categorias WHERE nombre = ?")
    .bind(nombre).first();
  return json(actualizado);
}

async function deleteCategoria(nombre: string, request: Request, db: ReturnType<typeof dbFromEnv>) {
  const cat = await db.prepare("SELECT id FROM categorias WHERE nombre = ?")
    .bind(nombre).first();
  if (!cat) return error("Categoría no encontrada", 404);

  const { count } = await db.prepare(
    "SELECT COUNT(*) as count FROM movimientos WHERE categoria_id = ?"
  ).bind(cat.id).first();

  if (count > 0) {
    let reassignTo: string | null = null;
    try {
      const body = await request.json();
      reassignTo = body?.reassignTo ? String(body.reassignTo).trim() : null;
    } catch (_) { /* sin cuerpo */ }

    if (!reassignTo) {
      return json({
        error: "tiene_movimientos",
        count,
        message: `Esta categoría tiene ${count} movimiento(s). Indica a qué categoría reasignarlos.`,
      }, 409);
    }

    if (reassignTo === nombre) {
      return error("La categoría de destino tiene que ser distinta de la que borras", 400);
    }

    const destino = await db.prepare("SELECT id FROM categorias WHERE nombre = ?")
      .bind(reassignTo).first();
    if (!destino) return error("La categoría de destino no existe", 404);

    await db.prepare("UPDATE movimientos SET categoria_id = ? WHERE categoria_id = ?")
      .bind(destino.id, cat.id).run();
  }

  await db.prepare("DELETE FROM categorias WHERE id = ?").bind(cat.id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// movimientos
// ---------------------------------------------------------------------

async function getMovimientos(db: ReturnType<typeof dbFromEnv>) {
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

async function createMovimiento(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const descripcion = (body.descripcion || "").trim();
  const categoria = (body.categoria || "").trim();
  const tipo = body.tipo === "income" ? "income" : "expense";
  const importe = Number(body.importe);
  const fecha = body.fecha || new Date().toISOString().slice(0, 10);

  if (!descripcion) return error("La descripción es obligatoria");
  if (!categoria) return error("La categoría es obligatoria");
  if (!importe || importe <= 0) return error("El importe debe ser mayor que 0");

  const cat = await db.prepare("SELECT id FROM categorias WHERE nombre = ?")
    .bind(categoria).first();
  if (!cat) return error("La categoría indicada no existe", 404);

  const result = await db.prepare(
    "INSERT INTO movimientos (descripcion, categoria_id, tipo, import
