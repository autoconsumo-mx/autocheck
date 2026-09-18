# Autocheck — autoconsumo.mx

Formulario público (wizard de 7 pasos) para que empresas con instalaciones de autoconsumo de combustible evalúen qué tan listas están para su registro regulatorio (SENER/CRE/CNE/ASEA) ante la CNE.

- **Sitio en vivo:** https://autocheck.autoconsumo.mx
- **Documentación completa del proyecto (historial de sesiones, decisiones, pendientes):** [`docs/formulario-autocheck.md`](docs/formulario-autocheck.md)

## Estructura del repo

- `index.html` — el sitio completo (HTML/CSS/JS vanilla, sin build step). Esto es lo que se despliega tal cual en Netlify.
- `supabase/functions/enviar-reporte-autocheck/` — Edge Function de Supabase (Deno + pdf-lib) que genera el reporte en PDF y lo envía por correo vía Resend al terminar un autocheck.
- `docs/formulario-autocheck.md` — documentación viva del proyecto: decisiones de producto, historial de sesiones, pendientes.

## Despliegue

**HTML (Netlify):**
Hoy el deploy es manual (subir `index.html` al dropzone de Netlify, sitio `autocheck-autoconsumo`). Pendiente: conectar este repo a Netlify vía "Import from Git" para que cada push a `main` dispare un deploy automático.

**Edge Function (Supabase):**
```
supabase functions deploy enviar-reporte-autocheck --project-ref qdelfelmvwnehyzfzrav
```
(o vía el MCP de Supabase / dashboard). El proyecto de Supabase es `qdelfelmvwnehyzfzrav` (org Autoconsumo, región us-east-2).

## Notas
- No hay build step: `index.html` es un solo archivo autocontenido (CSS y JS inline, logo como data URI).
- Las credenciales de Supabase (URL + anon key) están embebidas en el HTML — son públicas por diseño (anon key), la seguridad real vive en las políticas RLS de la base de datos.
- Nunca commitear API keys privadas (Resend, service_role de Supabase, etc.) a este repo — esas viven en Supabase Vault / variables de entorno de la Edge Function.
