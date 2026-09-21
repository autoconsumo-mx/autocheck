-- Cuestionario Autocheck — registro de instalaciones de autoconsumo de combustible
-- Ejecuta este script una sola vez en el SQL Editor de un proyecto de Supabase NUEVO
-- (Project > SQL Editor > New query > pegar y RUN) para reconstruirlo desde cero.
--
-- Actualizado 21-sep-2026 (sesión 8) a partir del esquema real del proyecto `autocheck`
-- (qdelfelmvwnehyzfzrav), leído directamente vía MCP de Supabase — reemplaza la versión
-- anterior, que quedó desactualizada tras la reconstrucción del proyecto el 17-sep-2026
-- (ver docs/formulario-autocheck.md, sesión 4).

create table if not exists public.leads_autocheck_estaciones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Datos generales
  empresa text not null,
  nombre_instalacion text,
  nombre_contacto text not null,
  correo text not null,
  whatsapp text,

  -- Instalación y tanques
  combustibles text[],                      -- p.ej. {Diesel,Gasolina}
  cantidad_tanques integer,
  capacidad_tanques numeric[],              -- en miles de litros, uno por tanque
  antiguedad_anios integer,

  -- Permisos y documentación
  tiene_permiso boolean,
  permisos_vigentes text[],                 -- SENER / CRE / CNE
  tiene_informe_preventivo_mia boolean,
  tiene_titulo_o_contrato_predio boolean,
  tiene_planos boolean,
  tiene_factura_garantia_tanque boolean,

  -- Compras y facturación
  compro_facturo_2025 boolean,
  compro_facturo_2026 boolean,
  tiene_3_facturas_anio boolean,
  conoce_permiso_distribuidor boolean,
  reporta_controles_volumetricos_sat boolean,

  -- Operación
  surte_solo_vehiculos_propios boolean,
  tiene_relacion_vehiculos boolean,
  instalacion_operando boolean,
  estado text,

  -- Antecedentes regulatorios
  inspeccion_asea boolean,
  inspeccion_cne boolean,
  inspeccion_fiscalia_mp_gn boolean,
  procedimiento_clausura_sancion boolean,
  solicito_permiso_antes boolean,
  le_negaron_permiso_antes boolean,

  -- Interés e interpretación automática del autocheck
  interes_gestionar_permiso boolean,
  tipo_registro text,                             -- 'por_mi_cuenta' | 'con_acompanamiento'
  lead_plus boolean,                              -- true si eligió 'con_acompanamiento' (clasificación interna)
  alertas_criticas jsonb default '[]',            -- (legado — ver alertas_rojas/alertas_amarillas abajo)
  alertas_rojas jsonb default '[]',               -- texto de cada alerta roja disparada
  alertas_amarillas jsonb default '[]',           -- texto de cada alerta amarilla disparada
  tier_resultado text,                            -- p.ej. 'critico' | ... (nivel general del resultado)
  elegible_registro boolean,                      -- false si: ya tiene permiso, no surte solo a vehículos propios, o no está operando
  puntaje integer,                                -- score del autocheck, ver tabla de puntos
  puntaje_max integer,
  porcentaje_puntaje numeric,                     -- puntaje normalizado 0-100

  -- Consentimiento (Aviso de Privacidad)
  acepta_aviso_privacidad boolean not null default true,
  aviso_privacidad_version text not null default '2026-09-07',

  -- CTA final del resultado (qué botón eligió el lead en la pantalla de resultado)
  interes_cta text,
  interes_cta_en timestamptz
);

comment on table public.leads_autocheck_estaciones is 'Respuestas del autocheck público para instalaciones de autoconsumo de combustible que buscan gestionar su registro (SENER/CRE/CNE/ASEA)';

-- Nota: la versión anterior de este script tenía una columna `status` ('nuevo' |
-- 'contactado' | 'descartado' | 'convertido') para seguimiento interno. No existe en
-- el proyecto real actual — se perdió en la reconstrucción del 17-sep-2026 y nunca se
-- volvió a agregar. Sigue pendiente decidir si el equipo interno necesita ver/dar
-- seguimiento a los leads desde el portal (ver docs/formulario-autocheck.md, "Pendiente" #6).

-- Seguridad: el lead se inserta DESPUÉS de verificar su correo por OTP (el usuario ya
-- tiene una sesión de Supabase Auth en ese momento), así que el INSERT se permite a
-- `authenticated`, no a `anon`. Los GRANT de tabla a nivel anon/authenticated/service_role
-- (SELECT/INSERT/UPDATE/DELETE/etc.) los aplica Supabase automáticamente al crear la
-- tabla vía SQL Editor — la restricción real vive en RLS.
alter table public.leads_autocheck_estaciones enable row level security;

create policy "insertar_autenticado"
  on public.leads_autocheck_estaciones
  for insert
  to authenticated
  with check (true);

-- Si más adelante el equipo interno necesita ver las respuestas desde el portal
-- (usuarios autenticados como staff), agregar una política de SELECT — no existe
-- todavía porque no se ha decidido (ver Pendiente #6):
-- create policy "Staff autenticado puede ver los autochecks"
--   on public.leads_autocheck_estaciones
--   for select
--   to authenticated
--   using (true);

-- ─────────────────────────────────────────────────────────────────────────
-- Funciones RPC usadas por el sitio (index.html)
-- ─────────────────────────────────────────────────────────────────────────

-- Usada en la pantalla de resultado para saber si el correo ya tiene autochecks
-- previos (auth.jwt() ->> 'email' viene de la sesión OTP ya verificada).
create or replace function public.contar_autochecks_usuario()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  select count(*)::integer
  from public.leads_autocheck_estaciones
  where correo = auth.jwt() ->> 'email';
$$;

revoke execute on function public.contar_autochecks_usuario() from public;
grant execute on function public.contar_autochecks_usuario() to authenticated, service_role;

-- Marca qué CTA final eligió el lead en la pantalla de resultado (por correo del
-- lead autenticado, para que no pueda marcar el interés de otro lead ajeno).
create or replace function public.marcar_interes_cta(p_id uuid, p_tipo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.leads_autocheck_estaciones
  set interes_cta = p_tipo,
      interes_cta_en = now()
  where id = p_id
    and correo = auth.jwt() ->> 'email';
end;
$$;

revoke execute on function public.marcar_interes_cta(uuid, text) from public;
grant execute on function public.marcar_interes_cta(uuid, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Vault: API key de Resend para el envío del PDF (Edge Function enviar-reporte-autocheck)
-- ─────────────────────────────────────────────────────────────────────────
-- Requiere la extensión Supabase Vault, habilitada por defecto en proyectos nuevos.
-- NO pegues la API key aquí ni la commitees al repo — créala manualmente una sola vez
-- desde el SQL Editor del dashboard (no desde este archivo, y no vía Claude/MCP):
--
--   select vault.create_secret('re_TU_API_KEY_DE_RESEND_AQUI', 'resend_api_key');
--
-- Esta key es INDEPENDIENTE de la que usa el Custom SMTP de Supabase Auth (esa vive en
-- Authentication > Emails > SMTP Settings, no en el Vault) — ver docs/formulario-autocheck.md,
-- sesión 7, para la distinción entre ambas.

create or replace function public.obtener_resend_api_key()
returns text
language sql
security definer
set search_path to ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
$$;

revoke execute on function public.obtener_resend_api_key() from public;
grant execute on function public.obtener_resend_api_key() to service_role;
