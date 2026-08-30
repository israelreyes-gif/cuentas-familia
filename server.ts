/**
 * server.ts
 * -----------------------------------------------------------------------
 * API de "Cuentas de casa" corriendo en Deno Deploy. Habla con D1
 * (Cloudflare) por su API HTTP a través de un "puente" que imita
 * env.DB.prepare()... para que el resto del código sea igual que en
 * Cloudflare Workers.
 *
 * Incluye:
 *   - generación automática de gastos fijos el día 1 de cada mes
 *   - envío real de notificaciones push (aviso de nómina), también el
 *     día 1, con la misma criptografía VAPID que usaba Cloudflare
 * -----------------------------------------------------------------------
 */

const ALLOWED_ORIGIN = "https://israelreyes-gif.github.io";
const SESSION_DAYS = 7;
const DESC_GASTO_FIJO = "Gasto fijo mensual";

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
// gastos fijos automáticos
// ---------------------------------------------------------------------

async function generarGastosFijos(db: ReturnType<typeof dbFromEnv>) {
  const hoy = new Date();
  const primerDiaMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const { results: fijas } = await db.prepare(
    "SELECT id, presupuesto FROM categorias WHERE fija = 1 AND presupuesto > 0"
  ).all();

  let creados = 0;
  for (const cat of fijas) {
    const yaExiste = await db.prepare(
      "SELECT id FROM movimientos WHERE categoria_id = ? AND fecha = ? AND descripcion = ?"
    ).bind(cat.id, primerDiaMes, DESC_GASTO_FIJO).first();

    if (yaExiste) continue;

    await db.prepare(
      "INSERT INTO movimientos (descripcion, categoria_id, tipo, importe, fecha) VALUES (?, ?, 'expense', ?, ?)"
    ).bind(DESC_GASTO_FIJO, cat.id, cat.presupuesto, primerDiaMes).run();
    creados++;
  }

  return creados;
}

// ---------------------------------------------------------------------
// notificaciones push: criptografía VAPID + cifrado aes128gcm
// (misma lógica que en Cloudflare, usando Web Crypto — disponible igual
// en Deno)
// ---------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function importVapidPrivateKey(privateKeyB64url: string, publicKeyB64url: string) {
  const pub = b64urlDecode(publicKeyB64url);
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk = {
    kty: "EC", crv: "P-256",
    x: b64urlEncode(x), y: b64urlEncode(y), d: privateKeyB64url,
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function createVapidJwt(privateKey: CryptoKey, audience: string, subject: string) {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const enc = new TextEncoder();
  const signingInput =
    b64urlEncode(enc.encode(JSON.stringify(header))) + "." + b64urlEncode(enc.encode(JSON.stringify(claims)));

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(signingInput)
  );
  return signingInput + "." + b64urlEncode(new Uint8Array(signature));
}

async function encryptPayload(payloadText: string, p256dhB64url: string, authB64url: string) {
  const enc = new TextEncoder();
  const uaPublic = b64urlDecode(p256dhB64url);
  const authSecret = b64urlDecode(authB64url);

  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const subscriberPublicKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: subscriberPublicKey }, serverKeyPair.privateKey, 256)
  );

  async function hmacSha256(keyBytes: Uint8Array, dataBytes: Uint8Array) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
  }

  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(enc.encode("WebPush: info\0"), uaPublic, asPublicRaw);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);

  const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
  const cek = (await hmacSha256(prk, concatBytes(cekInfo, new Uint8Array([1])))).slice(0, 16);

  const nonceInfo = enc.encode("Content-Encoding: nonce\0");
  const nonce = (await hmacSha256(prk, concatBytes(nonceInfo, new Uint8Array([1])))).slice(0, 12);

  const plaintext = concatBytes(enc.encode(payloadText), new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext)
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

interface PushSub {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendWebPush(sub: PushSub, payloadText: string) {
  const endpointUrl = new URL(sub.endpoint);
  const audience = endpointUrl.origin;

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
  const privateKey = await importVapidPrivateKey(Deno.env.get("VAPID_PRIVATE_KEY")!, publicKey);
  const jwt = await createVapidJwt(privateKey, audience, Deno.env.get("VAPID_SUBJECT")!);
  const body = await encryptPayload(payloadText, sub.p256dh, sub.auth);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Authorization": `vapid t=${jwt}, k=${publicKey}`,
    },
    body,
  });

  if (!res.ok) {
    const err = new Error("Push service respondió " + res.status);
    (err as any).status = res.status;
    throw err;
  }
}

async function enviarAvisoNomina(db: ReturnType<typeof dbFromEnv>) {
  const { results: subs } = await db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions").all();

  const payload = JSON.stringify({
    title: "Cuentas de casa",
    body: "Ya es día 1 — no olvides registrar la nómina de este mes.",
  });

  let enviados = 0;
  for (const sub of subs as PushSub[]) {
    try {
      await sendWebPush(sub, payload);
      enviados++;
    } catch (err) {
      if ((err as any).status === 404 || (err as any).status === 410) {
        await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
      }
    }
  }
  return enviados;
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
    "INSERT INTO movimientos (descripcion, categoria_id, tipo, importe, fecha) VALUES (?, ?, ?, ?, ?)"
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

async function deleteMovimiento(id: number, db: ReturnType<typeof dbFromEnv>) {
  const result = await db.prepare("DELETE FROM movimientos WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return error("Movimiento no encontrado", 404);
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// notificaciones push (guardar/borrar suscripción)
// ---------------------------------------------------------------------

async function pushSubscribe(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const sub = body?.subscription;
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return error("Suscripción push inválida");
  }

  await db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
  `).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth).run();

  return json({ ok: true });
}

async function pushUnsubscribe(request: Request, db: ReturnType<typeof dbFromEnv>) {
  const body = await request.json();
  const endpoint = body?.endpoint;
  if (!endpoint) return error("Falta el endpoint de la suscripción");

  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// punto de entrada
// ---------------------------------------------------------------------

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const db = dbFromEnv();

  try {
    if (path === "/api/auth/registro" && method === "POST") {
      return await registro(request, db);
    }
    if (path === "/api/auth/login" && method === "POST") {
      return await login(request, db);
    }

    const auth = await requireAuth(request, db);
    if (!auth.ok) return auth.response!;

    if (path === "/api/categorias" && method === "GET") {
      return await getCategorias(db);
    }
    if (path === "/api/categorias" && method === "POST") {
      return await createCategoria(request, db);
    }
    const catMatch = path.match(/^\/api\/categorias\/([^/]+)$/);
    if (catMatch && method === "PATCH") {
      return await updateCategoria(decodeURIComponent(catMatch[1]), request, db);
    }
    if (catMatch && method === "DELETE") {
      return await deleteCategoria(decodeURIComponent(catMatch[1]), request, db);
    }

    if (path === "/api/movimientos" && method === "GET") {
      return await getMovimientos(db);
    }
    if (path === "/api/movimientos" && method === "POST") {
      return await createMovimiento(request, db);
    }
    const movMatch = path.match(/^\/api\/movimientos\/(\d+)$/);
    if (movMatch && method === "DELETE") {
      return await deleteMovimiento(Number(movMatch[1]), db);
    }

    if (path === "/api/push/subscribe" && method === "POST") {
      return await pushSubscribe(request, db);
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      return await pushUnsubscribe(request, db);
    }

    return error("Ruta no encontrada", 404);
  } catch (err) {
    return error("Error interno: " + err.message, 500);
  }
});

// ---------------------------------------------------------------------
// tareas programadas: ambas el día 1 de cada mes
// ---------------------------------------------------------------------

Deno.cron("gastos-fijos-mensuales", "0 3 1 * *", async () => {
  const db = dbFromEnv();
  await generarGastosFijos(db);
});

Deno.cron("aviso-nomina", "0 6 1 * *", async () => {
  const db = dbFromEnv();
  await enviarAvisoNomina(db);
});
