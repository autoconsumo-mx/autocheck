// Supabase Edge Function: webhook-compra-plus
// Recibe el aviso de pago de "Autocheck Plus" (HubSpot Workflow -> acción "Trigger webhook"),
// otorga +5 autochecks extra (acumulable) al correo del comprador, crea el ticket de venta
// en Alegra (a "Público en General", pagado con tarjeta) y le manda al cliente un correo con
// su ticket y la liga para autofacturar en el portal de Alegra.
//
// Seguridad: sin verify_jwt (HubSpot no manda un JWT de Supabase). En su lugar valida
// un secreto compartido (?secret=... en la URL, guardado en Vault como
// 'webhook_compra_plus_secret') para que nadie mas pueda llamar este endpoint y
// autorotorgarse cupo gratis.
//
// Configura en HubSpot la acción "Trigger webhook" del Workflow con:
//   URL:    https://<project>.supabase.co/functions/v1/webhook-compra-plus?secret=<secreto>
//   Method: POST
//   Body (JSON): {"correo": "{{ contact.email }}", "nombre": "{{ contact.firstname }}"}
//
// Alegra: requiere el secreto de Edge Functions ALEGRA_TOKEN (token con permisos mínimos,
// autenticación Bearer). Si Alegra o el correo fallan, el cupo ya quedó otorgado: el error
// se registra en logs y se regresa en la respuesta, pero no se revierte la compra.

import { createClient } from "npm:@supabase/supabase-js@2";

const CANTIDAD_POR_COMPRA = 5;

// IDs en el Alegra de Fuel Experts (verificados vía API el 22-sep-2026).
const ALEGRA_API = "https://api.alegra.com/api/v1";
const ALEGRA_CLIENTE_PUBLICO_GENERAL = 1;
const ALEGRA_NUMERACION_TICKET = 2; // "Ticket Principal", serie T
const ALEGRA_ITEM_AUTOCHECK_PLUS = 14;
const ALEGRA_IVA_16 = 2;
const PRECIO_SIN_IVA = 1292.24; // + IVA 16% = $1,499.00
const NOTA_TICKET = "Pagado con tarjeta en autocheck.autoconsumo.mx";
const PORTAL_AUTOFACTURA = "https://portal.alegra.com/invoice-generator";

const RESEND_FROM_EMAIL = "autocheck@autoconsumo.mx";
const RESEND_FROM_NAME = "Autocheck · autoconsumo.mx";
const CORREO_AYUDA = "ayuda@mail.autoconsumo.mx";

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

async function crearTicketAlegra(fecha: string) {
  const token = (Deno.env.get("ALEGRA_TOKEN") || "").trim();
  if (!token) throw new Error("Falta el secreto ALEGRA_TOKEN");
  const res = await fetch(`${ALEGRA_API}/sale-tickets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      date: fecha,
      dueDate: fecha,
      client: { id: ALEGRA_CLIENTE_PUBLICO_GENERAL },
      numberTemplate: { id: ALEGRA_NUMERACION_TICKET },
      paymentType: "PUE",
      paymentMethod: "credit-card",
      anotation: NOTA_TICKET,
      items: [{ id: ALEGRA_ITEM_AUTOCHECK_PLUS, price: PRECIO_SIN_IVA, quantity: 1, tax: [{ id: ALEGRA_IVA_16 }] }],
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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [correo],
      reply_to: CORREO_AYUDA,
      subject: "Tu compra de Autocheck Plus — ticket y factura",
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const url = new URL(req.url);
    const secretRecibido = url.searchParams.get("secret") || "";
    const { data: secretReal, error: secretErr } = await supabaseAdmin.rpc("obtener_webhook_compra_plus_secret");
    if (secretErr || !secretReal) {
      throw new Error("No se pudo obtener el secreto del webhook: " + (secretErr?.message || "no configurado"));
    }
    if (secretRecibido !== secretReal) {
      return new Response(JSON.stringify({ ok: false, error: "secreto inválido" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const correo = body?.correo;
    if (!esCorreoValido(correo)) {
      return new Response(JSON.stringify({ ok: false, error: "Falta un correo válido en el body" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim().split(/\s+/)[0] : "";

    const { data: nuevoCupo, error: otorgarErr } = await supabaseAdmin.rpc("otorgar_cupo_extra_autocheck_plus", {
      p_correo: correo,
      p_cantidad: CANTIDAD_POR_COMPRA,
    });
    if (otorgarErr) {
      throw new Error("No se pudo otorgar el cupo extra: " + otorgarErr.message);
    }

    // A partir de aquí el cupo ya está otorgado: un fallo de Alegra o del correo no debe
    // regresar error a HubSpot (lo reintentaría y otorgaría el cupo dos veces).
    let ticket: Ticket | null = null;
    let correoEnviado = false;
    const errores: string[] = [];
    try {
      ticket = await crearTicketAlegra(hoyCdmx());
    } catch (e) {
      console.error("Ticket Alegra falló para", correo, e);
      errores.push("alegra: " + String((e as Error)?.message || e));
    }
    if (ticket) {
      try {
        const { data: resendKey, error: keyErr } = await supabaseAdmin.rpc("obtener_resend_api_key");
        if (keyErr || !resendKey) throw new Error("No se pudo obtener la API key de Resend: " + (keyErr?.message || "no configurada"));
        await enviarCorreoCompra(correo.trim(), nombre, ticket, resendKey as string);
        correoEnviado = true;
      } catch (e) {
        console.error("Correo de compra falló para", correo, "ticket", ticket.folio, e);
        errores.push("correo: " + String((e as Error)?.message || e));
      }
    }

    return new Response(
      JSON.stringify({ ok: true, correo, cupo_extra_total: nuevoCupo, ticket: ticket && { folio: ticket.folio, codigo: ticket.codigo }, correo_enviado: correoEnviado, errores }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
