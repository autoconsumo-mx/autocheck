// Supabase Edge Function: panel-interno
// Datos agregados para el dashboard interno de staff (docs/mockups/dashboard-interno-mockup.png).
// Solo responde a correos que estén en public.autocheck_staff (verificado con service_role,
// nunca se expone leads_autocheck_estaciones directo por RLS a "authenticated").

import { createClient } from "npm:@supabase/supabase-js@2";

const LIMITE_AUTOCHECKS_GRATIS = 3;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function respuestaJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function tieneCombustible(combustibles: unknown, buscados: string[]): boolean {
  if (!Array.isArray(combustibles)) return false;
  const normalizados = combustibles.map((c) => String(c).toLowerCase());
  return buscados.some((b) => normalizados.includes(b));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user?.email) return respuestaJson({ ok: false, error: "Sesión inválida" }, 401);
    const correoStaff = userData.user.email.trim().toLowerCase();

    const { data: staff } = await supabaseAdmin.from("autocheck_staff").select("correo").eq("correo", correoStaff).maybeSingle();
    if (!staff) return respuestaJson({ ok: false, error: "No autorizado" }, 403);

    const [{ data: leads, error: leadsErr }, { data: membresias }, { data: pagos }] = await Promise.all([
      supabaseAdmin
        .from("leads_autocheck_estaciones")
        .select("correo, nombre_contacto, nombre_instalacion, estado, combustibles, created_at, tier_resultado, alertas_rojas, alertas_amarillas, interes_cta")
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("autocheck_membresias").select("correo, cupo_extra"),
      supabaseAdmin.from("autocheck_plus_pagos_procesados").select("correo"),
    ]);
    if (leadsErr) throw new Error("No se pudieron leer los autochecks: " + leadsErr.message);

    const cupoExtraPorCorreo = new Map<string, number>();
    for (const m of membresias || []) cupoExtraPorCorreo.set(String(m.correo).toLowerCase(), m.cupo_extra || 0);

    const compraronPorCorreo = new Set<string>();
    for (const p of pagos || []) compraronPorCorreo.add(String(p.correo).toLowerCase());
    for (const [correo, cupo] of cupoExtraPorCorreo) if (cupo > 0) compraronPorCorreo.add(correo);

    // Agrupa cada autocheck por el correo (en minúsculas) de su suscriptor.
    const porCorreo = new Map<string, typeof leads>();
    for (const l of leads || []) {
      const clave = String(l.correo).trim().toLowerCase();
      if (!porCorreo.has(clave)) porCorreo.set(clave, []);
      porCorreo.get(clave)!.push(l);
    }

    let con1 = 0, con2 = 0, con3Mas = 0;
    let alertaCritica = 0, conAdvertencias = 0, sinAlertas = 0;
    const porEstado = new Map<string, number>();
    let agendaConsulta = 0;
    const miembros: Array<Record<string, unknown>> = [];

    for (const [correo, filas] of porCorreo) {
      const n = filas!.length;
      if (n === 1) con1++;
      else if (n === 2) con2++;
      else con3Mas++;

      for (const f of filas!) {
        const rojas = Array.isArray(f.alertas_rojas) ? f.alertas_rojas.length : 0;
        const amarillas = Array.isArray(f.alertas_amarillas) ? f.alertas_amarillas.length : 0;
        if (rojas > 0) alertaCritica++;
        else if (amarillas > 0) conAdvertencias++;
        else sinAlertas++;

        if (f.estado) porEstado.set(f.estado, (porEstado.get(f.estado) || 0) + 1);
        if (typeof f.interes_cta === "string" && f.interes_cta.startsWith("agendar_cita")) agendaConsulta++;
      }

      const ultimo = filas![filas!.length - 1];
      const primero = filas![0];
      const cupoExtra = cupoExtraPorCorreo.get(correo) || 0;
      const combustiblesUnion = filas!.flatMap((f) => Array.isArray(f.combustibles) ? f.combustibles : []);

      miembros.push({
        nombre: ultimo.nombre_contacto || "",
        correo,
        alta: primero.created_at,
        member: compraronPorCorreo.has(correo) ? "plus" : "free",
        autochecks_usados: n,
        autochecks_limite: LIMITE_AUTOCHECKS_GRATIS + cupoExtra,
        nick: ultimo.nombre_instalacion || "",
        estado: ultimo.estado || "",
        gasolina: tieneCombustible(combustiblesUnion, ["gasolina"]),
        diesel: tieneCombustible(combustiblesUnion, ["diesel", "diésel"]),
        gas_lp: tieneCombustible(combustiblesUnion, ["glp", "gas lp"]),
        gas_natural: tieneCombustible(combustiblesUnion, ["gn", "gas natural"]),
      });
    }

    miembros.sort((a, b) => new Date(b.alta as string).getTime() - new Date(a.alta as string).getTime());

    return respuestaJson({
      ok: true,
      usuarios: {
        total_suscriptores: porCorreo.size,
        autochecks_ejecutados: leads?.length ?? 0,
        con_1: con1,
        con_2: con2,
        con_3_mas: con3Mas,
      },
      calidad: {
        total: leads?.length ?? 0,
        con_alerta_critica: alertaCritica,
        con_advertencias: conAdvertencias,
        sin_alertas: sinAlertas,
      },
      resultados: {
        autocheck_plus: compraronPorCorreo.size,
        precheck_pro: 0,
        agenda_consulta: agendaConsulta,
      },
      regiones: [...porEstado.entries()].map(([estado, total]) => ({ estado, total })).sort((a, b) => b.total - a.total),
      miembros,
    });
  } catch (e) {
    console.error(e);
    return respuestaJson({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
