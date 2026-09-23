// Supabase Edge Function: webhook-compra-plus
// Recibe el aviso de pago de "Autocheck Plus", otorga +5 autochecks extra (acumulable) al
// correo del comprador, crea el ticket de venta en Alegra (a "Público en General", pagado con
// tarjeta) y le manda al cliente un correo con su ticket y la liga para autofacturar.
//
// Dos formas de llamarla (sin verify_jwt: ninguna manda un JWT de Supabase):
//
// 1. Stripe (la principal): los Payment Links de HubSpot cobran con la cuenta de Stripe de
//    Alfredo, y HubSpot Starter no permite workflows con webhook. Endpoint en el dashboard de
//    Stripe apuntando a esta URL (sin ?secret) con el evento `charge.succeeded`. Se valida la
//    firma `Stripe-Signature` con el secreto STRIPE_WEBHOOK_SECRET; solo se procesan cobros
//    de $1,499.00 MXN, y cada pago una sola vez (tabla autocheck_plus_pagos_procesados), porque
//    Stripe reintenta los avisos.
//
// 2. Manual / HubSpot: POST ?secret=<secreto en Vault 'webhook_compra_plus_secret'> con body
//    {"correo": "...", "nombre": "..."}. Sirve para otorgar una compra a mano.
//
// Alegra: secreto de Edge Functions ALEGRA_TOKEN (token JWT limitado), ver authAlegra().
// Si Alegra o el correo fallan, el cupo ya quedó otorgado: el error se registra en logs
// y se regresa en la respuesta, pero no se revierte la compra.
// Respaldo: si no se pudo crear el ticket en Alegra, el cliente recibe una confirmación sin
// ticket y ayuda@mail.autoconsumo.mx un aviso para crear el ticket a mano.

import { createClient } from "npm:@supabase/supabase-js@2";

const CANTIDAD_POR_COMPRA = 5;

// IDs en el Alegra de Fuel Experts (verificados vía API el 22-sep-2026).
const ALEGRA_API = "https://api.alegra.com/api/v1";
const ALEGRA_CLIENTE_PUBLICO_GENERAL = 1;
const ALEGRA_NUMERACION_TICKET = 2; // "Ticket Principal", serie T
const ALEGRA_ITEM_AUTOCHECK_PLUS = 14;
const ALEGRA_IVA_16 = 2;
const PRECIO_SIN_IVA = 1292.24; // + IVA 16% = $1,499.00
const PRECIO_CON_IVA = 1499;
const ALEGRA_CUENTA_COBROS = 5; // "Cheques BBVA" — donde caen los depósitos de Stripe
const NOTA_TICKET = "Pagado con tarjeta en autocheck.autoconsumo.mx";
const PORTAL_AUTOFACTURA = "https://portal.alegra.com/invoice-generator";

const RESEND_FROM_EMAIL = "autocheck@autoconsumo.mx";
const RESEND_FROM_NAME = "Autocheck · autoconsumo.mx";
const CORREO_AYUDA = "ayuda@mail.autoconsumo.mx";

const MONTO_STRIPE_CENTAVOS = 149900; // $1,499.00 MXN
const TOLERANCIA_FIRMA_SEG = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function esCorreoValido(correo: unknown): correo is string {
  return typeof correo === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim());
}

function escaparHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Fecha de hoy en la Ciudad de México, formato YYYY-MM-DD (lo que espera Alegra).
function hoyCdmx() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

function fechaLarga(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

// El portal de autofacturación acepta tickets hasta el último día del mes de la venta.
function ultimoDiaDelMes(iso: string) {
  const [a, m] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
}

// Token JWT con permisos granulares (el que se usa, "Autocheck-Plus"): auth Bearer.
// Token clásico de Alegra (acceso total, solo de respaldo): ALEGRA_USER (correo) + ALEGRA_TOKEN, auth Basic.
function authAlegra() {
  const token = (Deno.env.get("ALEGRA_TOKEN") || "").trim();
  if (!token) throw new Error("Falta el secreto ALEGRA_TOKEN");
  if (token.split(".").length === 3) return `Bearer ${token}`;
  const usuario = (Deno.env.get("ALEGRA_USER") || "").trim();
  return usuario ? `Basic ${btoa(`${usuario}:${token}`)}` : `Bearer ${token}`;
}

// En Alegra los tickets de venta son facturas con una numeración de tipo "saleTicket":
// se crean con POST /invoices (POST /sale-tickets responde 200 con [] y no crea nada;
// /sale-tickets solo sirve para descargar PDFs).
async function crearTicketAlegra(fecha: string) {
  const res = await fetch(`${ALEGRA_API}/invoices`, {
    method: "POST",
    headers: { Authorization: authAlegra(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      date: fecha,
      dueDate: fecha,
      client: { id: ALEGRA_CLIENTE_PUBLICO_GENERAL },
      numberTemplate: { id: ALEGRA_NUMERACION_TICKET },
      paymentType: "PUE",
      paymentMethod: "credit-card",
      anotation: NOTA_TICKET,
      items: [{ id: ALEGRA_ITEM_AUTOCHECK_PLUS, price: PRECIO_SIN_IVA, quantity: 1, tax: [{ id: ALEGRA_IVA_16 }] }],
      payments: [{ date: fecha, account: { id: ALEGRA_CUENTA_COBROS }, amount: PRECIO_CON_IVA, paymentMethod: "credit-card" }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Alegra respondió ${res.status}: ${JSON.stringify(data)}`);
  if (!data?.uniqueCode) throw new Error(`Alegra no regresó código de ticket: ${JSON.stringify(data)}`);
  return {
    id: String(data.id),
    folio: data.numberTemplate?.fullNumber as string | undefined,
    codigo: data.uniqueCode as string,
    fecha: (data.date as string) || fecha,
    ligaFactura: (data.qrCodeSelfInvoicingContent as string) || `${PORTAL_AUTOFACTURA}?code=${encodeURIComponent(data.uniqueCode)}&date=${fecha}`,
  };
}

type Ticket = Awaited<ReturnType<typeof crearTicketAlegra>>;

async function enviarCorreoCompra(correo: string, nombre: string, ticket: Ticket, resendKey: string) {
  const saludo = nombre ? `Hola, ${escaparHtml(nombre)}:` : "Hola:";
  const limite = fechaLarga(ultimoDiaDelMes(ticket.fecha));
  const html = `
<p>${saludo}</p>
<p>¡Gracias por tu compra! Ya tienes <strong>${CANTIDAD_POR_COMPRA} autochecks adicionales</strong> disponibles en tu cuenta.</p>
<h3>Tu ticket de compra</h3>
<ul>
  <li>Código de ticket: <strong>${escaparHtml(ticket.codigo)}</strong></li>
  <li>Fecha de emisión: <strong>${fechaLarga(ticket.fecha)}</strong></li>
  <li>Total: <strong>$1,499.00 MXN</strong> (IVA incluido)</li>
</ul>
<h3>¿Necesitas factura?</h3>
<p>Puedes generarla tú mismo en un par de minutos:</p>
<ol>
  <li>Entra a <a href="${escaparHtml(ticket.ligaFactura)}"><strong>Solicitar mi factura →</strong></a> (tu código y fecha ya van llenos).</li>
  <li>Si te los pide, escribe la fecha y el código de ticket de arriba.</li>
  <li>Captura tus datos fiscales tal como aparecen en tu Constancia de Situación Fiscal.</li>
</ol>
<p>⚠️ Tienes hasta el <strong>${limite}</strong> para solicitarla. Después ya no será posible autofacturar esta compra.</p>
<p>¿Dudas con tu factura? Escríbenos a <a href="mailto:${CORREO_AYUDA}">${CORREO_AYUDA}</a>.</p>
<p>— autoconsumo.mx</p>`;

  return await enviarResend(correo, "Tu compra de Autocheck Plus — ticket y factura", html, resendKey);
}

// Respaldo si Alegra falla: confirmación sin ticket.
async function enviarCorreoCompraSinTicket(correo: string, nombre: string, resendKey: string) {
  const saludo = nombre ? `Hola, ${escaparHtml(nombre)}:` : "Hola:";
  const html = `
<p>${saludo}</p>
<p>¡Gracias por tu compra! Ya tienes <strong>${CANTIDAD_POR_COMPRA} autochecks adicionales</strong> disponibles en tu cuenta.</p>
<p>Total: <strong>$1,499.00 MXN</strong> (IVA incluido).</p>
<h3>¿Necesitas factura?</h3>
<p>En un máximo de un día hábil te enviaremos por correo tu ticket de compra con la liga para que generes tu factura tú mismo.</p>
<p>¿Dudas? Escríbenos a <a href="mailto:${CORREO_AYUDA}">${CORREO_AYUDA}</a>.</p>
<p>— autoconsumo.mx</p>`;
  return await enviarResend(correo, "Tu compra de Autocheck Plus", html, resendKey);
}

// Aviso interno: hay que crear el ticket a mano en Alegra y mandárselo al cliente.
async function enviarAvisoTicketManual(correo: string, nombre: string, fecha: string, error: string, resendKey: string) {
  const html = `
<p><strong>Nueva compra de Autocheck Plus sin ticket en Alegra.</strong> El cliente ya tiene sus ${CANTIDAD_POR_COMPRA} autochecks y recibió su confirmación; falta el ticket.</p>
<ul>
  <li>Correo: <strong>${escaparHtml(correo)}</strong></li>
  <li>Nombre: ${escaparHtml(nombre || "(sin nombre)")}</li>
  <li>Fecha de la venta: ${fechaLarga(fecha)}</li>
</ul>
<p>Qué hacer:</p>
<ol>
  <li>En Alegra crea un <strong>Ticket de venta</strong> a Público en General: Autocheck-Plus, $1,292.24 + IVA = $1,499.00, pagado con tarjeta.</li>
  <li>Reenvía el PDF del ticket al cliente (trae el código y el QR para autofacturar).</li>
</ol>
<p style="color:#888;font-size:12px">Error de Alegra: ${escaparHtml(error)}</p>`;
  return await enviarResend(CORREO_AYUDA, `Crear ticket Alegra — Autocheck Plus — ${correo}`, html, resendKey);
}

async function enviarResend(para: string, asunto: string, html: string, resendKey: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [para],
      reply_to: CORREO_AYUDA,
      subject: asunto,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// Aviso interno cuando llega un cobro de Autocheck Plus en Stripe sin correo del comprador.
async function enviarAvisoSinCorreo(pagoId: string, nombre: string, resendKey: string) {
  const html = `
<p><strong>Llegó un cobro de Autocheck Plus ($1,499.00) en Stripe sin correo del comprador.</strong> No se otorgaron autochecks ni se creó ticket.</p>
<ul>
  <li>Pago en Stripe: <strong>${escaparHtml(pagoId)}</strong></li>
  <li>Nombre: ${escaparHtml(nombre || "(sin nombre)")}</li>
</ul>
<p>Busca el pago en Stripe o HubSpot para obtener el correo y otórgale la compra a mano.</p>`;
  return await enviarResend(CORREO_AYUDA, `Revisar pago Autocheck Plus sin correo — ${pagoId}`, html, resendKey);
}

function respuestaJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function hexDe(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function igualesSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Verifica el encabezado Stripe-Signature ("t=...,v1=...") según la documentación de Stripe:
// HMAC-SHA256 de "<t>.<cuerpo crudo>" con el signing secret del endpoint.
async function firmaStripeValida(cuerpo: string, encabezado: string, secreto: string) {
  const partes = encabezado.split(",").map((p) => p.trim().split("="));
  const t = partes.find(([k]) => k === "t")?.[1];
  const firmas = partes.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || firmas.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCIA_FIRMA_SEG) return false;
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = hexDe(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`${t}.${cuerpo}`)));
  return firmas.some((f) => igualesSeguro(f, esperada));
}

type Supa = ReturnType<typeof createClient>;

async function obtenerResendKey(supabaseAdmin: Supa) {
  const { data, error } = await supabaseAdmin.rpc("obtener_resend_api_key");
  if (error || !data) throw new Error("No se pudo obtener la API key de Resend: " + (error?.message || "no configurada"));
  return data as string;
}

// Otorga el cupo, crea el ticket y manda los correos. Lanza error solo si falla el cupo;
// lo demás se reporta en `errores` (el cupo ya quedó otorgado y no debe repetirse).
async function procesarCompra(supabaseAdmin: Supa, correo: string, nombre: string) {
  const { data: nuevoCupo, error: otorgarErr } = await supabaseAdmin.rpc("otorgar_cupo_extra_autocheck_plus", {
    p_correo: correo,
    p_cantidad: CANTIDAD_POR_COMPRA,
  });
  if (otorgarErr) {
    throw new Error("No se pudo otorgar el cupo extra: " + otorgarErr.message);
  }

  const fecha = hoyCdmx();
  let ticket: Ticket | null = null;
  let correoEnviado = false;
  let avisoEnviado = false;
  const errores: string[] = [];
  try {
    ticket = await crearTicketAlegra(fecha);
  } catch (e) {
    console.error("Ticket Alegra falló para", correo, e);
    errores.push("alegra: " + String((e as Error)?.message || e));
  }
  try {
    const resendKey = await obtenerResendKey(supabaseAdmin);
    if (ticket) {
      await enviarCorreoCompra(correo, nombre, ticket, resendKey);
      correoEnviado = true;
    } else {
      // Respaldo manual: el cliente recibe su confirmación sin ticket, y el equipo un aviso
      // para crear el ticket a mano en Alegra y mandárselo.
      await enviarCorreoCompraSinTicket(correo, nombre, resendKey);
      correoEnviado = true;
      await enviarAvisoTicketManual(correo, nombre, fecha, errores.join(" | "), resendKey);
      avisoEnviado = true;
    }
  } catch (e) {
    console.error("Correo de compra/aviso falló para", correo, "ticket", ticket?.folio, e);
    errores.push("correo: " + String((e as Error)?.message || e));
  }

  if (!(await sincronizarHubspot(correo))) errores.push("hubspot: no se sincronizó (ver logs de sincronizar-hubspot)");

  return { ok: true, correo, cupo_extra_total: nuevoCupo, ticket: ticket && { folio: ticket.folio, codigo: ticket.codigo }, correo_enviado: correoEnviado, aviso_ticket_manual: avisoEnviado, errores };
}

// Pasa la compra a HubSpot (nivel Member Plus, negocio a "Compra"). No bloquea la compra si falla.
async function sincronizarHubspot(correo: string) {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sincronizar-hubspot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ correo }),
    });
    if (!res.ok) console.error("sincronizar-hubspot respondió", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error("No se pudo llamar a sincronizar-hubspot:", e);
    return false;
  }
}

async function manejarStripe(req: Request, supabaseAdmin: Supa, firma: string) {
  const secreto = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();
  if (!secreto) throw new Error("Falta el secreto STRIPE_WEBHOOK_SECRET");
  const cuerpo = await req.text();
  if (!(await firmaStripeValida(cuerpo, firma, secreto))) {
    return respuestaJson({ ok: false, error: "firma de Stripe inválida" }, 400);
  }

  const evento = JSON.parse(cuerpo);
  if (evento.type !== "charge.succeeded") return respuestaJson({ ok: true, ignorado: `evento ${evento.type}` });
  const cargo = evento.data?.object ?? {};
  if (cargo.amount !== MONTO_STRIPE_CENTAVOS || String(cargo.currency).toLowerCase() !== "mxn") {
    return respuestaJson({ ok: true, ignorado: `cobro de ${cargo.amount} ${cargo.currency}, no es Autocheck Plus` });
  }

  const pagoId = String(cargo.payment_intent || cargo.id);
  const nombre = typeof cargo.billing_details?.name === "string" ? cargo.billing_details.name.trim().split(/\s+/)[0] : "";
  const correoCrudo = cargo.billing_details?.email || cargo.receipt_email || "";
  if (!esCorreoValido(correoCrudo)) {
    console.error("Cobro de Autocheck Plus sin correo:", pagoId);
    await enviarAvisoSinCorreo(pagoId, nombre, await obtenerResendKey(supabaseAdmin));
    return respuestaJson({ ok: true, sin_correo: pagoId });
  }
  const correo = correoCrudo.trim().toLowerCase();

  // Reclamar el pago antes de procesarlo: si Stripe reenvía el aviso, el segundo no pasa de aquí.
  const { data: reclamado, error: reclamoErr } = await supabaseAdmin
    .from("autocheck_plus_pagos_procesados")
    .upsert({ pago_id: pagoId, correo }, { onConflict: "pago_id", ignoreDuplicates: true })
    .select("pago_id");
  if (reclamoErr) throw new Error("No se pudo registrar el pago: " + reclamoErr.message);
  if (!reclamado || reclamado.length === 0) return respuestaJson({ ok: true, duplicado: pagoId });

  try {
    const resultado = await procesarCompra(supabaseAdmin, correo, nombre);
    if (resultado.ticket?.folio) {
      await supabaseAdmin.from("autocheck_plus_pagos_procesados").update({ ticket_folio: resultado.ticket.folio }).eq("pago_id", pagoId);
    }
    return respuestaJson({ ...resultado, pago_id: pagoId });
  } catch (e) {
    // El cupo no se otorgó: liberar el pago para que el reintento de Stripe lo vuelva a intentar.
    await supabaseAdmin.from("autocheck_plus_pagos_procesados").delete().eq("pago_id", pagoId);
    throw e;
  }
}

async function manejarManual(req: Request, supabaseAdmin: Supa) {
  const secretRecibido = new URL(req.url).searchParams.get("secret") || "";
  const { data: secretReal, error: secretErr } = await supabaseAdmin.rpc("obtener_webhook_compra_plus_secret");
  if (secretErr || !secretReal) {
    throw new Error("No se pudo obtener el secreto del webhook: " + (secretErr?.message || "no configurado"));
  }
  if (secretRecibido !== secretReal) return respuestaJson({ ok: false, error: "secreto inválido" }, 401);

  const body = await req.json().catch(() => ({}));
  const correo = body?.correo;
  if (!esCorreoValido(correo)) return respuestaJson({ ok: false, error: "Falta un correo válido en el body" }, 400);
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().split(/\s+/)[0] : "";
  // Siempre 200 tras otorgar el cupo: un 5xx haría que el llamador reintentara y otorgara doble.
  return respuestaJson(await procesarCompra(supabaseAdmin, correo.trim(), nombre));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const firma = req.headers.get("stripe-signature");
    return firma ? await manejarStripe(req, supabaseAdmin, firma) : await manejarManual(req, supabaseAdmin);
  } catch (e) {
    console.error(e);
    return respuestaJson({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
