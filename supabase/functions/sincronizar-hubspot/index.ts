// Supabase Edge Function: sincronizar-hubspot
// Pasa a HubSpot todo lo que sabemos de un usuario del Autocheck: crea/actualiza su contacto
// (datos de su autocheck más reciente, nivel de membresía, autochecks realizados/disponibles)
// y mueve su negocio en el pipeline REGISTRO CNE. Siempre recalcula desde la base de datos,
// así que llamarla de más no hace daño.
//
// Quién la llama (verify_jwt activo):
//  - El sitio, con la sesión del usuario, al verificar su código, al terminar un autocheck y al
//    tocar "Agenda una consulta". Solo puede sincronizar su propio correo (se toma del JWT).
//  - webhook-compra-plus, con la service_role key, al registrar una compra: body {"correo": "..."}.
//
// HubSpot: clave de servicio en el secreto HUBSPOT_TOKEN (contacts + deals read/write).
// HubSpot Starter no tiene workflows con webhook, por eso el pipeline lo mueve este código.

import { createClient } from "npm:@supabase/supabase-js@2";

const HUBSPOT_API = "https://api.hubapi.com";
const LIMITE_AUTOCHECKS_GRATIS = 3;

// Pipeline REGISTRO CNE y sus etapas, en orden. El negocio solo avanza: nunca se regresa, y si
// ya está en una etapa que se mueve a mano (servicio prestado, registro generado, declinado)
// no se toca.
const PIPELINE_ID = "936463482";
const ETAPAS = {
  freemium: "1441501015",
  autocheck: "1441501016",
  compra: "1441501017",
  sesion: "1441501018",
};
const ORDEN_ETAPAS = [ETAPAS.freemium, ETAPAS.autocheck, ETAPAS.compra, ETAPAS.sesion];

const RANGO_MEMBRESIA: Record<string, number> = { freemium: 0, plus: 1, gold: 2 };

// Valores del Autocheck -> opciones de la propiedad "combustibles" que ya existía en HubSpot.
const COMBUSTIBLES: Record<string, string> = {
  diesel: "Diésel",
  "diésel": "Diésel",
  gasolina: "Gasolina",
  glp: "Gas LP",
  "gas lp": "Gas LP",
  gn: "Gas Natural",
  "gas natural": "Gas Natural",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuestaJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function hubspot(ruta: string, opciones: RequestInit = {}) {
  const token = (Deno.env.get("HUBSPOT_TOKEN") || "").trim();
  if (!token) throw new Error("Falta el secreto HUBSPOT_TOKEN");
  const res = await fetch(HUBSPOT_API + ruta, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function soloFecha(fecha: string | null | undefined) {
  return fecha ? new Date(fecha).toISOString().slice(0, 10) : undefined;
}

function sinVacios(props: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = String(v);
  }
  return out;
}

type Supa = ReturnType<typeof createClient>;

async function sincronizar(supabaseAdmin: Supa, correo: string) {
  const [{ data: leads, error: leadsErr }, { data: membresia }, { data: pagos }, { data: enlace }] = await Promise.all([
    // ilike: el sitio guarda el correo tal como lo escribió el usuario (puede traer mayúsculas).
    supabaseAdmin.from("leads_autocheck_estaciones").select("*").ilike("correo", correo).order("created_at", { ascending: false }),
    supabaseAdmin.from("autocheck_membresias").select("cupo_extra").eq("correo", correo).maybeSingle(),
    supabaseAdmin.from("autocheck_plus_pagos_procesados").select("procesado_en").eq("correo", correo).order("procesado_en", { ascending: false }).limit(1),
    supabaseAdmin.from("hubspot_sync").select("contacto_id, negocio_id").eq("correo", correo).maybeSingle(),
  ]);
  if (leadsErr) throw new Error("No se pudieron leer los autochecks: " + leadsErr.message);

  const ultimo = leads?.[0];
  const realizados = leads?.length ?? 0;
  const cupoExtra = membresia?.cupo_extra ?? 0;
  const compro = cupoExtra > 0 || (pagos?.length ?? 0) > 0;
  const interesCta = leads?.find((l) => l.interes_cta)?.interes_cta ?? null;

  // Contacto actual (si existe) para no bajar su nivel de membresía (p. ej. un Gold puesto a mano).
  const actual = await hubspot(`/crm/v3/objects/contacts/${encodeURIComponent(correo)}?idProperty=email&properties=nivel_membresia`);
  const nivelActual = actual.ok ? actual.data?.properties?.nivel_membresia : null;
  const nivelDerivado = compro ? "plus" : "freemium";
  const nivel = (RANGO_MEMBRESIA[nivelActual] ?? -1) > RANGO_MEMBRESIA[nivelDerivado] ? nivelActual : nivelDerivado;

  const nombre = String(ultimo?.nombre_contacto || "").trim().split(/\s+/);
  const opcionales = sinVacios({
    entidad: ultimo?.estado,
    combustibles: Array.isArray(ultimo?.combustibles)
      ? [...new Set(ultimo.combustibles.map((c: string) => COMBUSTIBLES[String(c).toLowerCase()] || "Otros"))].join(";")
      : undefined,
  });
  const propiedades = sinVacios({
    email: correo,
    firstname: nombre[0],
    lastname: nombre.slice(1).join(" "),
    company: ultimo?.empresa,
    hs_whatsapp_phone_number: ultimo?.whatsapp,
    mobilephone: ultimo?.whatsapp,
    nivel_membresia: nivel,
    autochecks_realizados: realizados,
    autochecks_disponibles: Math.max(0, LIMITE_AUTOCHECKS_GRATIS + cupoExtra - realizados),
    fecha_ultimo_autocheck: soloFecha(ultimo?.created_at),
    fecha_compra_autocheck_plus: soloFecha(pagos?.[0]?.procesado_en),
    ultimo_interes_cta: interesCta,
    ac_instalacion: ultimo?.nombre_instalacion,
    ac_resultado: ultimo?.tier_resultado,
    ac_puntaje_pct: ultimo?.porcentaje_puntaje,
    ac_elegible_registro: ultimo?.elegible_registro,
    ac_alertas_criticas: Array.isArray(ultimo?.alertas_criticas) ? ultimo.alertas_criticas.length : undefined,
    ac_alertas_rojas: Array.isArray(ultimo?.alertas_rojas) ? ultimo.alertas_rojas.length : undefined,
    ac_alertas_amarillas: Array.isArray(ultimo?.alertas_amarillas) ? ultimo.alertas_amarillas.length : undefined,
    ac_tipo_registro: ultimo?.tipo_registro,
    ac_cantidad_tanques: ultimo?.cantidad_tanques,
    ac_capacidad_total_litros: Array.isArray(ultimo?.capacidad_tanques)
      ? ultimo.capacidad_tanques.reduce((s: number, n: number) => s + (Number(n) || 0), 0)
      : undefined,
    ac_antiguedad_anios: ultimo?.antiguedad_anios,
    ac_instalacion_operando: ultimo?.instalacion_operando,
    ac_tiene_permiso: ultimo?.tiene_permiso,
    ac_permisos_vigentes: Array.isArray(ultimo?.permisos_vigentes) ? ultimo.permisos_vigentes.join(", ") : undefined,
    ac_interes_gestionar_permiso: ultimo?.interes_gestionar_permiso,
    ac_solicito_permiso_antes: ultimo?.solicito_permiso_antes,
    ac_le_negaron_permiso: ultimo?.le_negaron_permiso_antes,
    ac_inspeccion_asea: ultimo?.inspeccion_asea,
    ac_inspeccion_cne: ultimo?.inspeccion_cne,
    ac_inspeccion_fiscalia: ultimo?.inspeccion_fiscalia_mp_gn,
    ac_procedimiento_clausura: ultimo?.procedimiento_clausura_sancion,
    ac_controles_volumetricos_sat: ultimo?.reporta_controles_volumetricos_sat,
    ac_informe_preventivo_mia: ultimo?.tiene_informe_preventivo_mia,
    ac_compro_facturo_2025: ultimo?.compro_facturo_2025,
    ac_compro_facturo_2026: ultimo?.compro_facturo_2026,
    ac_tres_facturas_anio: ultimo?.tiene_3_facturas_anio,
    ac_conoce_permiso_distribuidor: ultimo?.conoce_permiso_distribuidor,
    ac_surte_solo_vehiculos_propios: ultimo?.surte_solo_vehiculos_propios,
    ac_relacion_vehiculos: ultimo?.tiene_relacion_vehiculos,
    ac_titulo_contrato_predio: ultimo?.tiene_titulo_o_contrato_predio,
    ac_tiene_planos: ultimo?.tiene_planos,
    ac_factura_garantia_tanque: ultimo?.tiene_factura_garantia_tanque,
  });

  // Crear o actualizar el contacto por correo. Si HubSpot rechaza un valor de las propiedades que
  // ya existían (entidad/combustibles, con opciones fijas), se reintenta sin ellas.
  const upsert = (props: Record<string, string>) =>
    hubspot("/crm/v3/objects/contacts/batch/upsert", {
      method: "POST",
      body: JSON.stringify({ inputs: [{ idProperty: "email", id: correo, properties: props }] }),
    });
  const avisos: string[] = [];
  let r = await upsert({ ...propiedades, ...opcionales });
  if (!r.ok && Object.keys(opcionales).length > 0) {
    avisos.push(`sin entidad/combustibles: ${r.data?.message ?? r.status}`);
    r = await upsert(propiedades);
  }
  if (!r.ok) throw new Error(`HubSpot rechazó el contacto (${r.status}): ${JSON.stringify(r.data)}`);
  const contactoId = String(r.data?.results?.[0]?.id);

  // Etapa que le corresponde según lo que ha hecho.
  let etapaObjetivo = ETAPAS.freemium;
  if (realizados > 0) etapaObjetivo = ETAPAS.autocheck;
  if (compro) etapaObjetivo = ETAPAS.compra;
  if (interesCta) etapaObjetivo = ETAPAS.sesion;

  let negocioId: string | null = enlace?.negocio_id ?? null;
  let etapaFinal = etapaObjetivo;
  if (negocioId) {
    const negocio = await hubspot(`/crm/v3/objects/deals/${negocioId}?properties=dealstage`);
    if (negocio.status === 404) {
      negocioId = null; // lo borraron en HubSpot: se crea otro
    } else if (!negocio.ok) {
      throw new Error(`HubSpot no devolvió el negocio (${negocio.status}): ${JSON.stringify(negocio.data)}`);
    } else {
      const etapaActual = negocio.data?.properties?.dealstage;
      const rangoActual = ORDEN_ETAPAS.indexOf(etapaActual);
      etapaFinal = etapaActual;
      if (rangoActual !== -1 && ORDEN_ETAPAS.indexOf(etapaObjetivo) > rangoActual) {
        const mover = await hubspot(`/crm/v3/objects/deals/${negocioId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: { dealstage: etapaObjetivo } }),
        });
        if (!mover.ok) throw new Error(`HubSpot no movió el negocio (${mover.status}): ${JSON.stringify(mover.data)}`);
        etapaFinal = etapaObjetivo;
      }
    }
  }
  if (!negocioId) {
    const nuevo = await hubspot("/crm/v3/objects/deals", {
      method: "POST",
      body: JSON.stringify({
        properties: { dealname: `Autocheck — ${ultimo?.empresa || correo}`, pipeline: PIPELINE_ID, dealstage: etapaObjetivo },
        associations: [{ to: { id: contactoId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
      }),
    });
    if (!nuevo.ok) throw new Error(`HubSpot no creó el negocio (${nuevo.status}): ${JSON.stringify(nuevo.data)}`);
    negocioId = String(nuevo.data?.id);
  }

  await supabaseAdmin.from("hubspot_sync").upsert({ correo, contacto_id: contactoId, negocio_id: negocioId, sincronizado_en: new Date().toISOString() });
  return { ok: true, correo, contacto_id: contactoId, negocio_id: negocioId, etapa: etapaFinal, nivel_membresia: nivel, avisos };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const body = await req.json().catch(() => ({}));

    let correo: string | undefined;
    if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      correo = typeof body?.correo === "string" ? body.correo : undefined;
    } else {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user?.email) return respuestaJson({ ok: false, error: "sesión inválida" }, 401);
      correo = data.user.email;
    }
    if (!correo) return respuestaJson({ ok: false, error: "Falta el correo" }, 400);

    return respuestaJson(await sincronizar(supabaseAdmin, correo.trim().toLowerCase()));
  } catch (e) {
    console.error(e);
    return respuestaJson({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
