# Cuestionario Autocheck — instalaciones de autoconsumo de combustible

## Objetivo
Formulario público, tipo wizard (7 pasos), para que empresas con instalaciones de autoconsumo de combustible (diesel, gasolina, GLP, GN — para su propia flota, no venta al público) hagan un autocheck de qué tan lista está su instalación para gestionar su registro regulatorio (SENER/CRE/CNE/ASEA). Las respuestas se guardan en Supabase, incluyendo un puntaje numérico con medidor gráfico. El correo se verifica por OTP antes de dejar avanzar, para filtrar spam, y se pide consentimiento explícito (Aviso de Privacidad) antes de continuar.

## ⏸️ Sesión pausada — 22-sep-2026, actualización (fin de sesión 8) — Autocheck Plus lanzado, pipeline de HubSpot creado, Precheck Pro pospuesto

Continuación de la misma sesión 8 (empezó 21-sep, cruzó medianoche). Lo de abajo es lo que pasó **después** del fix de "acceso directo" y de `supabase_setup.sql` (ver esa sección, justo debajo de esta).

### 1. Opción A (confirmación de correo + auto-OTP) — ✅ verificada en vivo de punta a punta
Alfredo hizo un alta real (`contenidosfactory@gmail.com`) y confirmó por captura de pantalla + `auth_logs` que el flujo completo funciona: click en "Confirm email address" → sesión implícita → segundo OTP disparado solo → correo con la CLAVE recibido correctamente. Cerró también los tres pendientes de dashboard: plantilla+subject de "Confirm signup" en español/marca, subject de "Magic Link" en español, y confirmó que `autoconsumo.mx` está **Verified** en Resend desde hace 4 meses (descarta DNS como causa de que el correo cayera en spam). Detalle completo en la sección "Verificación por OTP" más abajo en este documento.

### 2. Pipeline "REGISTRO CNE" en HubSpot — ✅ creado y aprobado
Alfredo diseñó su propio set de 7 etapas (ligadas a un nuevo modelo de membresía freemium) y se creó vía MCP de HubSpot: [pipeline id `936463482`](https://app.hubspot.com/pipelines-settings/51056347/object/0-3/936463482). Detalle en "Monetización y pagos".

### 3. Autocheck Plus (+5 autochecks) — ✅ construido, probado y **en producción**
El límite de 3 autochecks gratis pasó de ser solo informativo a bloquear de verdad la entrada al wizard. Se construyó de cero: tabla de cupo extra en Supabase, funciones RPC, una Edge Function de webhook (`webhook-compra-plus`, protegida con secreto, probada con `curl` antes de desplegar), y la pantalla de compra en el sitio (con la ilustración e copy que dio Alfredo, precio $2,500→$1,499 MXN). Detalle técnico completo en "Autocheck Plus" dentro de "Monetización y pagos".
**Lo único que falta para que la compra sea 100% automática es que Alfredo cree el Producto + Payment Link + Workflow en HubSpot** (instrucciones exactas ya dadas, ver esa sección) — mientras tanto el botón usa un `mailto:` placeholder.

### 4. Precheck Pro — nuevo producto definido, explícitamente pospuesto
Alfredo compartió el copy y precio de un producto nuevo y distinto del "precheck" viejo ($25,000/$14,999 MXN, revisión de documentos con abogados+IA, portal propio). Se había agregado por error un link a esto en la pantalla de Autocheck Plus — Alfredo pidió quitarlo ("no lo incluyas aún") porque vive en su propio portal aparte. Meta: incorporarlo como cross-sell desde Autocheck antes del **25-sep-2026**. Detalle en "Precheck Pro" dentro de "Monetización y pagos".

### 5. Precio de "asistencia personalizada" — investigado, no resuelto del todo
Alfredo preguntó si ese Payment Link cobra de verdad — sí, $17,397.97 MXN (15% de descuento sobre $17,645 + IVA), confirmado navegando la página real de checkout. La "discrepancia de precio" pendiente desde hace varias sesiones sigue sin cerrarse porque, según Alfredo, "son varios productos" — no se investigó más a fondo esta sesión.

### 6. Arquitectura de pagos (Tarjeta→Stripe / SPEI→Mercado Pago) — reconfirmada sin cambios
Alfredo estaba explorando activar "Transferencias bancarias" en Stripe (que sí cubre México y funciona como un equivalente a SPEI) y por un momento pensó que esa había sido la decisión ya tomada. Se aclaró: lo documentado siempre fue SPEI vía Mercado Pago, Stripe solo para tarjeta. **Alfredo decidió: dejarlo como está documentado** (no cambió la arquitectura), y se fue a HubSpot a seguir con los pasos de Autocheck Plus.

### Pendiente inmediato al retomar, en orden
1. Alfredo termina en HubSpot: crear el Producto "Autocheck Plus", el Payment Link, y el Workflow con la acción "Trigger a webhook" (URL + secreto + body ya especificados en "Autocheck Plus" abajo).
2. En cuanto Alfredo pase el Payment Link real, reemplazar el placeholder `mailto:` de `urlAutocheckPlus` en `index.html` y redesplegar.
3. Hacer una compra real de prueba de Autocheck Plus de punta a punta (pago → webhook → cupo otorgado → se desbloquea el wizard) — no se probó todavía porque no existía el Payment Link real.
4. Confirmar con una alta nueva real que el correo "Confirm signup" ya no cae en spam ahora que tiene la plantilla de marca (pendiente desde antes, nunca se re-probó).
5. Retomar la discrepancia de precio de "asistencia personalizada" cuando Alfredo tenga tiempo de desenredar "los varios productos".
6. Antes del 25-sep-2026: incorporar Precheck Pro como cross-sell desde Autocheck (el portal de Precheck Pro en sí es un proyecto aparte, no construir aquí).
7. Pendientes de negocio sin tocar: dashboard interno para Alfredo (mockup guardado en `docs/mockups/dashboard-interno-mockup.png`, sin empezar a construir), detallar la membresía "gold" más allá de Autocheck Plus.

---

## ⏸️ Sesión pausada — 21-sep-2026 (sesión 8) — bug de "acceso directo" investigado y corregido

Retomó el pendiente #7/#17 de la sesión 7: por qué `op@energie.mx` (2 autochecks reales previos, 18-sep-2026) fue rechazado por "acceso directo" como si no tuviera suscripción activa.

### Causa raíz encontrada vía logs de Supabase
Se consultó `auth.users` (proyecto `qdelfelmvwnehyzfzrav`) y confirmó que la cuenta de Auth para `op@energie.mx` **sí existía** desde el 18-sep-2026 (`id d14bced8-8da7-4877-bd0e-8cdbcbfa20f3`, `confirmed_at` 18-sep). Después se consultaron los `auth_logs` (`query_logs`, `source = 'auth_logs'`) del 20-sep y aparecieron varios intentos de `/otp` para ese correo fallando con **errores 500 de SMTP**, no con "usuario no encontrado":
```
03:45–03:46  /otp  500  535 "Authentication credentials invalid"  (x3)
03:49:45     /otp  500  550 "mail.autoconsumo.mx domain is not verified..."
03:51:27     /otp  200  (ya arreglado el SMTP)
03:52:06     /verify 200 (login exitoso)
```
Es decir: la cuenta era válida todo el tiempo; lo que fallaba era el envío del correo (los mismos problemas de SMTP que se estaban corrigiendo en vivo esa sesión 7). El código en `index.html` (`btnAccesoEnviar` handler) solo distinguía el caso `429` (rate limit); **cualquier otro error, incluyendo estos 500 de SMTP, se interpretaba como "no hay suscripción activa"** y empujaba a un suscriptor real hacia el flujo de alta nueva. No era límite de OTPs (se descartó esa hipótesis con evidencia directa de los logs).

### Fix aplicado
[index.html:1351-1359](index.html:1351): nueva función `esErrorCuentaNoEncontrada(error)` que solo trata como "cuenta no encontrada" los errores 4xx (rechazo real de GoTrue por `shouldCreateUser:false`); cualquier 5xx o error sin `status` (fallo transitorio de red/SMTP) ahora muestra *"No pudimos enviar el código. Intenta de nuevo en un momento."* en vez de mandar al usuario a suscribirse de nuevo. Commit `8033e98`, push a `main`, deploy automático vía Netlify.

No se hizo prueba end-to-end real del flujo de acceso directo en este fix (para no gastar OTPs/correos reales de Resend sin necesidad) — la verificación fue: lectura directa de logs para confirmar la causa, y carga del archivo modificado en el navegador integrado para confirmar que no hay errores de consola (JS válido). Queda pendiente una prueba real de "acceso directo" con `op@energie.mx` la próxima vez que se retome el proyecto, para confirmar el mensaje correcto en un fallo real.

### `supabase_setup.sql` actualizado y agregado al repo
Se leyó el esquema real del proyecto (`qdelfelmvwnehyzfzrav`) directamente vía MCP de Supabase (`list_tables`, RLS policies, funciones RPC, permisos) y se reescribió el script, que llevaba desactualizado desde la reconstrucción del proyecto (17-sep-2026, sesión 4) y hasta ahora solo existía como archivo local en `Downloads`, nunca trackeado en el repo. Divergencias reales encontradas y corregidas:
- La política de INSERT es para el rol `authenticated`, no `anon` (el lead se inserta después de verificar el correo por OTP, cuando el usuario ya tiene sesión).
- `capacidad_tanques` es `numeric[]` en la tabla real, no `integer[]` como decía el script viejo.
- Faltaban 7 columnas que sí existen en la tabla real: `acepta_aviso_privacidad`, `aviso_privacidad_version`, `alertas_rojas`, `alertas_amarillas`, `tier_resultado`, `interes_cta`, `interes_cta_en`.
- La columna `status` del script viejo (para seguimiento interno) **ya no existe** en la tabla real — se perdió en la reconstrucción y nunca se volvió a crear (sigue relacionado con el pendiente #6, sin decidir).
- Faltaban por completo las funciones RPC `contar_autochecks_usuario()` y `marcar_interes_cta(uuid, text)` (usadas por `index.html`) y la función `obtener_resend_api_key()` del Vault, junto con sus permisos (`revoke`/`grant execute`).

El script sigue sin incluir la API key de Resend en texto plano (por diseño, según la nota de seguridad de este documento) — solo trae el comando `vault.create_secret(...)` como instrucción a correr manualmente desde el dashboard.

---

## ⏸️ Sesión pausada — 20-sep-2026 (sesión 7, primera en Claude Code) — Netlify conectado a GitHub, Auth arreglado, prueba end-to-end exitosa, bug de Vault y de color de medidor corregidos

**Primera sesión de este proyecto en Claude Code** (el trabajo de código se mudó aquí desde Cowork por el bloqueo de push descrito al final de la sesión 6). Se retomó desde el primer commit subido manualmente a `https://github.com/autoconsumo-mx/autocheck`.

### 1. Verificación de integridad del primer commit
Se comparó `index.html` y la Edge Function contra lo documentado en la sesión 6 (stepper numerado, `PROBLEMA_TEXTO`/`FORTALEZAS_TEXTO`, OTP de 8 dígitos, color `#F6B72B`, remitente `autocheck@autoconsumo.mx`, iconos de escudo/pipa, sin logo pequeño) — **todo coincide, sin divergencias.**

### 2. Netlify conectado al repo de GitHub — ✅ ya no es deploy manual
Alfredo entró a **Project configuration → Link repository** dentro del sitio existente `autocheck-autoconsumo` (NO usó "Add new site", que hubiera creado un sitio duplicado con otro nombre y roto el dominio). Quedó conectado: cada push a `main` dispara deploy automático. Confirmado visualmente en el navegador (contenido del sitio en vivo coincide con el repo, sin errores de consola) y confirmado de nuevo más tarde en la sesión con un segundo push real (ver punto 5).

### 3. Ajustes manuales de Supabase Auth — ✅ los tres completados
1. **Site URL**: cambiado de `http://localhost:3000` a `https://autocheck.autoconsumo.mx` (Authentication → URL Configuration).
2. **Redirect URLs**: se agregó `https://autocheck.autoconsumo.mx/**` (la lista estaba vacía antes — este era un hueco real, no solo el Site URL).
3. **Custom SMTP vía Resend**: host `smtp.resend.com`, puerto `465`, username `resend` (dato importante: Supabase/el navegador autocompletó el username con `autocheck` por error — el username correcto para Resend SIEMPRE es el texto literal `resend`, sin importar la cuenta). La primera API key pegada como password también falló (error `535 Authentication credentials invalid`); se generó una nueva en Resend y funcionó. Esto resolvió de un solo golpe el rate limit del mailer default de Supabase y la personalización del remitente de los correos de Auth.

### 4. Prueba end-to-end real completa — ✅ por fin hecha (llevaba pendiente desde sesión 4)
Se hizo con el correo de prueba `op@energie.mx` (llevada a cabo por Claude vía el navegador integrado, con Alfredo pasando el código OTP recibido):
- Suscripción nueva → correo pre-cargado, checkbox de Aviso de Privacidad → **Siguiente** → error inicial `500 Error sending magic link` (ver bug de SMTP arriba, ya resuelto en el momento) → tras corregir SMTP, OTP llegó correctamente.
- OTP de 8 dígitos verificado → avanzó al wizard.
- Wizard completo (7 pasos) llenado con datos de prueba variados → **Enviar autocheck** → pantalla de resultado renderizó correctamente (97%, 1 bandera roja real: *"No cuentas con al menos tres facturas de combustible de este año..."*, activada por responder "No" a esa pregunta del paso 4).
- **Lead confirmado en la base de datos** (`leads_autocheck_estaciones`, id `58dbec48-069a-4a38-9aeb-6ad02070f7c9`): score 97.1%, `tier_resultado: critico`, `elegible_registro: true`, `lead_plus: true` (por elegir "Con acompañamiento" en el paso 7) — todo coincide con las respuestas dadas.
- El envío automático del PDF por correo (fire-and-forget) **falló silenciosamente en el momento real del submit** — ver bug de Vault abajo.

### 5. Bug real encontrado y corregido: API key de Resend inválida en el Vault de Supabase
La Edge Function `enviar-reporte-autocheck` respondió `500` al invocarse durante la prueba real. El log de la función (vía `query_logs`, `source = 'function_logs'`) mostró la causa exacta: `Error: Resend respondió 401: {"message":"API key is invalid"}`. Esta es una key **distinta** a la del SMTP de Auth (arriba) — vive en `vault.secrets` (nombre `resend_api_key`, id `5cffcb3a-4bf7-482d-9fcf-d7e1516adace`, creada el 17-sep-2026 cuando se reconstruyó el proyecto, nunca actualizada desde entonces) y la lee la función `obtener_resend_api_key()`. Alfredo generó una nueva API key en Resend y se actualizó el secreto vía SQL (`select vault.update_secret(id, nueva_key)`). Se verificó el fix invocando la función manualmente dos veces desde la consola del navegador (con el `supabaseClient` ya autenticado en la página):
1. Con datos sintéticos de prueba → `{"ok":true}`, correo recibido.
2. Reenviado con la alerta roja **real** tomada de la fila en la base de datos (para no confundir a Alfredo con texto de prueba) → también exitoso.

**Tip para futuras depuraciones:** la función acepta `preview: true` en el payload — regresa el PDF crudo (`Blob`, `application/pdf`) sin mandar correo. Sirve para decodificar y revisar el PDF directamente sin gastar envíos reales de Resend.

### 6. Bug real encontrado y corregido: el medidor de score no coincidía entre el sitio web y el PDF
Al revisar el PDF de prueba (page 1, `SCORE 97%`), se notó que el anillo del medidor siempre es color naranja de marca en el PDF (`NARANJA`/`NARANJA_OSCURO`, fijo, línea `index.ts:252`), y solo el pill de abajo cambia de color según el nivel (rojo/amarillo/verde). En cambio, el sitio web coloreaba **tanto el anillo como el número del %** según el tier (`--gauge-color:${pill.color}` en `renderResultadoCompleto`). **Alfredo confirmó explícitamente que el comportamiento correcto es el del PDF: el medidor debe verse igual siempre, solo el pill cambia de color.** Se corrigió `index.html` (el anillo ahora usa `var(--naranja)` fijo, el número usa `var(--naranja-oscuro)` fijo) — commit `b9bf0ec`, push a `main`, deploy automático verificado en vivo (`fetch('/index.html')` desde el sitio en producción confirmó la versión nueva servida).

### Bug real encontrado, NO investigado a fondo — pendiente para otra sesión
**`op@energie.mx` ya tenía 2 autochecks reales previos** en la tabla (18-sep-2026, bajo la empresa "energie" — aparentemente el correo de trabajo real de Alfredo, usado antes en pruebas), lo que debería significar que ya es un suscriptor. Sin embargo, al probar "acceso directo" (`shouldCreateUser:false`) con ese correo al inicio de esta sesión, el sitio respondió correctamente-pero-incorrectamente: *"No encontramos una suscripción activa con ese correo."* Esto forzó a usar el flujo de suscripción nueva en su lugar. **Posible bug:** la lógica de "acceso directo" podría estar chequeando algo distinto a "¿ya hizo un autocheck antes?" (quizás un estado de confirmación de cuenta en Supabase Auth, o una tabla de suscriptores separada de los leads). No se investigó la causa raíz esta sesión — queda para revisar cuándo se retome.

---

## ⏸️ Sesión pausada — 18-sep-2026 (sesión 6) — batch grande de 39 fixes de Alfredo probando en vivo + 2 bugs reales de Auth + solicitud de GitHub

Alfredo probó el sitio en vivo a fondo (portada, pantalla de acceso, pantalla de resultado, wizard, y el PDF/correo recibido) y fue mandando ~39 observaciones por chat con capturas de pantalla, con instrucción explícita de **no ejecutar nada hasta que él lo indicara** ("te voy pasando observaciones, anotalas y ejecutamos cuando te indique"). Al terminar, dio la orden ("ya no puedo hacer mas pruebas. Ejecuta") y a media ejecución agregó una petición nueva: dejar el proyecto con control de versiones en GitHub para eficientar el trabajo.

### Fixes de UI/copy aplicados en `index.html` (delegado a un subagente, ya guardado en el proyecto vía `project_write`)
- Recuadro "¿Me registro o no?" con texto más visible (se quitó la itálica, tamaño y color más legibles).
- "Reporte simple y visual": ahora es un recuadro con borde, con 🔴/🟡 según severidad (antes solo puntos de color sueltos).
- Encabezado: "Autocheck de Registro" → **"Autocheck | Registro CNE"**.
- Subtítulo reemplazado por: "Portal de autoevaluación previa | Para conocer tu estatus y riesgos antes del registro de instalaciones de autoconsumo en la CNE".
- Se quitó el botón "← Volver" de la pantalla de acceso directo (se verificó que no era el único camino de regreso — "Corregirlo" sigue funcionando aparte).
- Pie: "...estamos mejorando **continuamente** este servicio para ti."
- Banner de "autochecks gratuitos" más discreto, y movido arriba de la barra de progreso.
- Barra de progreso más gruesa (6px→15px) y **se agregó un stepper de círculos numerados** (nuevo, antes solo había una barra delgada de %) — excluye del conteo el paso 0 ("Datos de tu suscripción"), que ya no cuenta como "Paso X de N" ni muestra la barra mientras está activo.
- Se separó el color de acento (`--status-warning-accent: #f6b72b`, amarillo-naranja brillante) del color de texto de alertas (`--amarillo`, que se queda oscuro para legibilidad) — corrige el "café/ocre" que se veía en la barra de avance y el gauge.
- Pantalla de resultado: conteo de avisos en negritas con ⚠️ ("Avisos y Advertencias"), conteo de banderas rojas en negritas con 🚩, caja "Tus Datos" más discreta (fondo ligero, letra más chica).
- Cada punto de alerta ahora antepone una frase de "problema" propia (no solo repite la pregunta de la encuesta) — nuevo mapa `PROBLEMA_TEXTO` + helper `textoAlertaConProblema()`, usado tanto en pantalla como en lo que se manda a la función de PDF (así el PDF hereda la misma mejora sin tocar el backend).
- El nombre de pila del contacto ahora se muestra en negritas seguido de dos puntos al inicio del mensaje de nivel, en vez de venir ya concatenado en el texto.
- **Bug real corregido (parcial, lado cliente):** en los tres puntos donde se pide el OTP (acceso directo, alta nueva, reenviar código), ahora se distingue un error de límite de envíos (HTTP 429 / `over_email_send_rate_limit`) de un correo genuinamente no encontrado — antes ambos mostraban el mismo mensaje engañoso "No encontramos una suscripción activa con ese correo."

**No se encontró** el "index 2" que Alfredo vio en una esquina (se buscó ese texto literal en todo el archivo) — si lo sigue viendo en el sitio en vivo, puede ser algo cacheado por el navegador o algo fuera de este HTML; avisar con una captura nueva si persiste.

**Sin tocar, a propósito:** la decisión pendiente de Alfredo sobre el flujo de confirmación de correo + primer OTP (Opción A: dos pasos separados, vs. Opción B: confirmar y mandar el primer OTP de inmediato) — sigue sin decidirse, no se tocó nada de esa lógica.

**Alerta para Alfredo:** el archivo de este proyecto (antes de este batch) todavía tenía solo una barra delgada de %, no el stepper de círculos numerados — si el sitio EN VIVO ya mostraba un stepper de círculos (como parecía en una de las capturas), puede haber una divergencia entre lo que estaba publicado en Netlify y este documento canónico. Confirmar visualmente después de subir este nuevo `index.html` a Netlify.

### Fixes del PDF aplicados y YA DESPLEGADOS en la Edge Function `enviar-reporte-autocheck` (v3, ACTIVE)
- Se quitó el arreglo de franjas decorativas del encabezado de la página 1 ("basura" visual) y el logo pequeño que iba ahí.
- Caja de datos (Ubicación/Almacenamiento/Capacidad/Combustible/Antigüedad): letra más chica y elegante.
- Nuevo color de acento amarillo-naranja brillante (`#F6B72B`) para el pill/score en el nivel de atención y la barra lateral de cajas amarillas — separado del amarillo oscuro que se usa para texto.
- Líneas de resumen ("Tienes N Avisos y Advertencias" / "Tienes N Bandera(s) Roja(s) - Puntos Críticos") ahora en negritas, con la misma redacción homologada del sitio web.
- "Puntos Adecuados" (página 2): se quitó la palomita blanca dentro de cada círculo verde (quedaban muchas y empalagaban) — ahora es un bullet verde simple; solo la palomita del encabezado de sección se conserva.
- Más espacio entre el ícono del SAT y su texto; tipografías más chicas y balanceadas en "Notas Importantes" y en la caja "¿YA TIENES PROTOCOLOS?".
- Se agregaron íconos simples (dibujados con formas primitivas de pdf-lib, sin paths/SVG) de un escudo para la línea de inspecciones y una pipa para la línea de suministro.
- Banner de marca inferior: se quitó el logo (se veía "empastelado" en chico) y se dejó una sola línea limpia "autoconsumo.mx", tal como aprobó Alfredo ("si no podemos insertar logo, ni modo").
- **Corregido el traslape de la "Noticia de uso" (aviso legal) con el pie de página** — se le dio más espacio vertical al bloque legal, se redujo el tamaño de letra y se movió el pie más abajo; se verificó con el ancho/tamaño reales del texto que ahora cabe con margen de sobra.
- El apodo de la instalación en la caja de datos ahora va en MAYÚSCULAS y más grande (14→16pt) — es el dato que Alfredo marcó como "el importante".

### Bugs reales de Auth investigados (root cause confirmado vía `query_logs`, **NO corregibles por herramientas de Claude — requieren que Alfredo los ajuste a mano en el dashboard de Supabase**)
1. **Liga de confirmación de correo redirige a `localhost`.** Todas las llamadas de Auth relevantes traían `referer: "http://localhost:3000"`. Lo más probable es que el proyecto nuevo (`qdelfelmvwnehyzfzrav`) haya nacido con el "Site URL" de Authentication → URL Configuration en el valor placeholder por default (`http://localhost:3000`) en vez de `https://autocheck.autoconsumo.mx`. **Fix manual necesario:** en el dashboard de Supabase del proyecto nuevo, Authentication → URL Configuration → cambiar "Site URL" (y agregar la Redirect URL correspondiente) a `https://autocheck.autoconsumo.mx`. No hay forma de leer/escribir esto por MCP.
2. **Nuevas suscripciones completamente bloqueadas + "no encontramos suscripción" en un correo que sí existía.** Ambos casos comparten la misma causa real: el límite de envíos del mailer default de Supabase Auth (`429 over_email_send_rate_limit`) — confirmado en los logs. El mailer default de Supabase tiene un límite bajo de correos/hora pensado solo para pruebas. **Fix manual necesario y recomendado:** configurar **Custom SMTP** en Authentication → Settings → SMTP Settings usando Resend (Alfredo ya tiene cuenta de Resend, usada para el envío del PDF) — esto además resuelve de una vez el pendiente de personalizar el remitente/subject de los correos de Supabase Auth (ver siguiente punto), ya que hoy llegan como "Supabase Auth" / `noreply@mail.app.supabase.io`.
3. **Personalizar el subject/remitente de los correos de confirmación y OTP de Supabase Auth** (pedido explícito de Alfredo en 2 capturas distintas) — esto vive en Authentication → Email Templates (subject) y en la configuración SMTP (remitente), ambos dashboard-only, sin tool de MCP para leerlos/escribirlos. Se resuelve en el mismo paso que el punto anterior (Custom SMTP vía Resend, con el subject editado directamente en cada plantilla de Email Templates).

### Repositorio de GitHub — ✅ creado en sesión 6 (18-sep-2026)
Alfredo pidió crear un repositorio de GitHub para tener control de versiones del HTML y demás archivos, y hacer más eficiente el trabajo/consumo de tokens. Se confirmó que esta cuenta de Claude no tiene ningún conector de GitHub instalado, así que Alfredo creó el repo manualmente y compartió un Personal Access Token de grano fino (scope: solo este repo, `Contents: Read and write`, `Metadata: Read-only`) para que Claude pudiera clonar y hacer el primer push desde el sandbox.

- **Repo:** `https://github.com/autoconsumo-mx/autocheck`
- **Estructura del primer commit:**
  - `index.html` — el HTML canónico completo (antes `index (2).html` en el proyecto de Claude Docs).
  - `supabase/functions/enviar-reporte-autocheck/index.ts` (+ `shims.d.ts`) — la Edge Function de generación de PDF y envío de correo.
  - `docs/formulario-autocheck.md` — este documento.
  - `README.md` — resumen rápido del proyecto y cómo desplegar.
- El proyecto de Claude Docs (`claude/formulario-autocheck.md`, `index (2).html`) sigue existiendo como respaldo, pero **el repo de GitHub pasa a ser la fuente canónica de aquí en adelante** — los cambios de código se deben hacer ahí (commit + push) en vez de reescribir el doc completo cada vez.
- **Siguiente paso sugerido (no ejecutado todavía):** conectar este repo a Netlify vía "Import from Git" (Netlify → Site settings → Build & deploy → Link to Git repository) para que cada push a `main` dispare un deploy automático — esto eliminaría el paso manual de subir el HTML al dropzone de Netlify cada vez.

### Pendiente inmediato, en orden
1. **Subir el `index.html` actualizado (con todos los fixes de esta sesión) a Netlify** — hasta que se conecte el repo a Netlify, sigue el mismo proceso manual de siempre (dropzone o Alfredo lo adjunta de nuevo en el chat).
2. Alfredo ajusta a mano en Supabase (proyecto `qdelfelmvwnehyzfzrav`): Site URL correcto (bug de localhost), y Custom SMTP vía Resend (resuelve el rate limit Y la personalización de subject/remitente de los correos de Auth de un solo golpe).
3. Confirmar visualmente el resultado de ambos fixes (HTML y PDF) en producción, y hacer por fin la prueba end-to-end real que sigue pendiente de sesiones anteriores.
4. Decidir Opción A vs B para el flujo de confirmación+OTP (pendiente, no se tocó).
5. Conectar el repo de GitHub a Netlify (Import from Git) para deploy automático.
6. Confirmar si el stepper de círculos numerados coincide o no con lo que ya estaba en vivo (ver alerta arriba).

---

## ⏸️ Sesión pausada — 17-sep-2026, actualización (fin de sesión 5), a petición de Alfredo ("actualiza documentacion, prepara promt para siguiente chat. pausamos")
**Continuación de la sesión 4 el mismo día.** Alfredo retomó los dos pendientes manuales del proyecto de Supabase nuevo (`qdelfelmvwnehyzfzrav`) y ambos quedaron resueltos de su lado:

1. **"Email OTP length" = 8 → ✅ CONFIRMADO HECHO por Alfredo.** Ya no es necesario volver a pedirlo.
2. **Plantilla de correo "Magic link or OTP" (diseño oscuro de marca) → ✅ RECUPERADA, AJUSTADA Y YA PEGADA EN SUPABASE.** Alfredo tenía guardado el HTML completo y lo compartió en el chat. Se ajustó con él (ver decisión abajo) y Alfredo confirmó haberla pegado en el dashboard ("listo, ya subi la plantilla").

**Lo único que falta para cerrar por completo el ciclo post-incidente es la prueba end-to-end real (ver "Pendiente inmediato" abajo) — Alfredo prefirió dejarla pendiente por ahora.** El resto de la recuperación (sitio en vivo, Supabase nuevo, plantilla de correo) está listo.

**Plantilla final acordada (lista para pegar tal cual):**
```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0D1B2A;color:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#112236;padding:24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08)">
    <img src="https://kzinwngzpgjorwwnypoq.supabase.co/storage/v1/object/public/assets/autoconsumo-200.png" width="56" height="56" alt="autoconsumo.mx" style="display:block;margin:0 auto;border-radius:50%"/>
    <div style="margin-top:8px;font-size:13px;color:#ABD3FF">Auto-check · Autoconsumo</div>
  </div>
  <div style="padding:32px 24px">
    <p style="font-size:16px;font-weight:600;margin:0 0 24px">¡Hola!</p>

    <p style="font-size:14px;color:#ffffff;font-weight:600;margin:0 0 4px;text-align:center">Para ingresar al Autocheck</p>
    <p style="font-size:13px;color:#ABD3FF;margin:0 0 14px;text-align:center">Usa esta CLAVE única:</p>

    <div style="background:#1A3048;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px;margin:0 0 20px;text-align:center">
      <span style="font-family:'Courier New',monospace;font-size:24px;font-weight:600;color:#ffffff !important;text-decoration:none !important;background:none !important;-webkit-text-fill-color:#ffffff !important;">{{ .Token }}</span>
    </div>

    <p style="font-size:13px;color:#ABD3FF;line-height:1.6;margin:0 0 24px;text-align:center">Es de un solo uso.<br>Expira en una hora.</p>

    <div style="border-top:1px solid rgba(255,255,255,0.08);margin:0 0 20px;"></div>

    <p style="font-size:12px;color:#8A9BB0;line-height:1.6;margin:0 0 16px;text-align:center">Borra este correo después de usar la CLAVE.</p>

    <p style="font-size:12px;color:#8A9BB0;line-height:1.6;margin:0">Si no solicitaste este acceso, puedes eliminar e ignorar este mensaje. Tu cuenta permanece segura.</p>
  </div>
  <div style="background:#112236;padding:16px 24px;text-align:center;border-top:1px solid rgba(255,255,255,0.08)">
    <p style="font-size:11px;color:#8A9BB0;margin:0">© 2026 autoconsumo.mx · Fuel Experts</p>
  </div>
</div>
```
**Cambio hecho respecto al original que compartió Alfredo:** la versión original traía un botón "Acceso al Portal" que apuntaba a `portal.autoconsumo.mx`. Se le hizo notar que el flujo del Autocheck no usa magic link — el usuario escribe la CLAVE de 8 dígitos directo en `autocheck.autoconsumo.mx` — así que ese botón no aplicaba aquí. **Alfredo decidió: quitar el botón** en vez de redirigirlo a `autocheck.autoconsumo.mx` o dejarlo apuntando al portal. La plantilla de arriba ya refleja esa decisión (sin botón).

**Nota sin resolver, no bloqueante:** el logo de la plantilla se sirve desde `kzinwngzpgjorwwnypoq.supabase.co` — un proyecto de Supabase distinto tanto al original borrado (`vuupbdfcyiulhqwemxya`) como al nuevo (`qdelfelmvwnehyzfzrav`), probablemente un proyecto de assets compartido entre los distintos portales de Alfredo. No se verificó que la imagen siga resolviendo (el sandbox de Claude no tiene salida de red hacia Supabase Storage) — vale la pena que Alfredo confirme visualmente que el logo carga bien al enviar un correo de prueba.

**Alfredo ya pegó la plantilla en el dashboard de Supabase (confirmado: "listo, ya subi la plantilla").** Con esto, los dos ajustes manuales del proyecto nuevo quedan completos de su lado. (Sigue sin confirmarse visualmente que el logo externo — `kzinwngzpgjorwwnypoq.supabase.co` — carga bien dentro del correo real; eso se verá en la prueba end-to-end.)

**Verificación visual del sitio en vivo (esta misma sesión, vía Claude in Chrome):** `https://autocheck.autoconsumo.mx` carga correctamente — portada completa (header, hero con medidor de ejemplo al 67%, recuadro "¿Me registro o no?", las dos tarjetas de camino nuevo/recurrente). No se avanzó el flujo real (ni suscripción ni acceso directo) en esta pasada — solo carga de la portada. No se detectaron errores de consola, aunque la página ya había cargado antes de empezar a capturar consola, así que no es una revisión exhaustiva.

**Pendiente inmediato que queda, en orden:**
1. ~~Alfredo pega la plantilla final en Supabase Dashboard~~ — ✅ hecho.
2. **Prueba end-to-end real completa** (sigue pendiente): suscripción nueva o acceso directo → OTP de 8 dígitos (con la plantilla nueva) → completar el autocheck → confirmar que (a) el lead se guarda bien en `leads_autocheck_estaciones`, (b) llega el correo con el PDF adjunto desde `autocheck@autoconsumo.mx` con buena pinta visual (comparado contra `autocheck ideas.pdf`), y (c) el logo del correo carga bien. **Se le preguntó a Alfredo cómo prefería hacerla (él solo, en vivo juntos pasando el código OTP, o solo verificación visual por ahora) — eligió, por ahora, dejarlo solo en verificación visual del sitio; la prueba real con OTP/correo/PDF sigue sin hacerse.**
3. Actualizar `supabase_setup.sql` para reflejar el estado real.
4. Seguir con los pendientes de negocio (pipeline HubSpot, discrepancia de precio, liga de precheck, plantilla "Confirm sign up") — ver detalle en la sección "Pendiente" al final de este documento.

---

## ⏸️ Sesión pausada — 17-sep-2026 (fin de sesión 4), a petición de Alfredo ("ok, actualiza documentacion y genera prompt para siguiente sesion. pausamos")
**Resumen de dónde quedó todo:** el desastre de Supabase (proyecto borrado por accidente) ya quedó completamente recuperado y el sitio en vivo ya vuelve a funcionar — **verificado en el navegador en esta misma sesión** (ver abajo). La feature de PDF/correo quedó construida y cableada del lado del cliente, pero **nunca se probó de extremo a extremo** (ni el envío de correo ni el PDF resultante). Le quedan a Alfredo 2 pendientes manuales cortos antes de que todo esté al 100% como estaba antes del incidente. Ver `claude/prompt-nuevo-chat.md` (proyecto de Claude Docs) para el prompt de arranque de la próxima sesión.

**Verificación en vivo (17-sep-2026, ya con el deploy de Alfredo hecho):** Alfredo confirmó "deployed" (subió `index (2).html` a Netlify él mismo). Se verificó con el navegador (Claude in Chrome):
- `https://autocheck.autoconsumo.mx` carga correctamente, con el rediseño completo (portada, pantalla de resultado nueva, etc.).
- Se probó el flujo de "acceso directo" con un correo de prueba desechable (`test-conexion-claude@autoconsumo.mx`) — Supabase respondió `AuthApiError: Signups not allowed for otp` (el error correcto y esperado para un correo no-suscriptor con `shouldCreateUser:false`), y la UI reaccionó bien mostrando "No encontramos una suscripción activa con ese correo" + botón "Quiero suscribirme". **Esto confirma un viaje de ida y vuelta real y exitoso al proyecto de Supabase nuevo (`qdelfelmvwnehyzfzrav`)** — no es un fallo de conexión a un proyecto muerto.
- **No se hizo una suscripción/autocheck real completo** (para no crear datos de prueba ni disparar un OTP/correo real de producción) — sigue pendiente una prueba end-to-end real para confirmar que el correo con el PDF efectivamente llega.

## Sesión 4 — 17-sep-2026 — Alfredo borró el proyecto de Supabase por accidente: recuperación completa + feature de PDF/correo

### El incidente
A media sesión, mientras se construía la función de generación de PDF (ver abajo), Alfredo escribió: **"ok tenemos una situacion, creo que borre el proyecto en supabase por error!!!"** — había eliminado accidentalmente, desde el dashboard de Supabase, el proyecto original completo (`vuupbdfcyiulhqwemxya`, "Autocheck", región us-east-1). Tras explicarle las opciones de recuperación, confirmó: **"no hay recuperacion, parece"**.

**Se perdió permanentemente:**
- Todos los leads/autochecks enviados desde el 7-sep-2026 en `leads_autocheck_estaciones`.
- Las cuentas de Supabase Auth de los suscriptores (todo el historial de correos verificados por OTP).
- El ajuste manual "Email OTP length = 8" en Authentication → Sign In/Providers → Email (decisión deliberada de Alfredo, documentada en este archivo pero no reproducible por API/MCP — **hay que volver a ponerlo a mano**).
- La plantilla de correo personalizada "Magic link or OTP" (diseño oscuro con marca, `{{ .Token }}`) — nunca quedó guardada en ningún documento de este proyecto, así que es una pérdida real **a menos que Alfredo la tenga guardada en otro lado** (captura de pantalla, otro respaldo, etc.).
- Las funciones RPC y el secreto de Vault originales (reconstruidos desde cero, ver abajo).

**No se perdió** (porque vivía fuera de Supabase): el HTML canónico del formulario, toda la documentación de este archivo, y el sitio publicado en Netlify (aunque quedó apuntando a un backend inexistente hasta terminar la reconstrucción).

### Dónde se recreó
Alfredo pidió primero crear el proyecto de reemplazo en una organización gratuita separada llamada "autocheck", pero se corrigió de inmediato: **"PERO SI ES MEJOR, HAZLO DENTRO DE AUTOCONSUMO, POR FAVOR"**. El intento de crearlo por API (`mcp__Supabase__create_project`) falló 3 veces seguidas con timeout de 180s sin causa clara (se descartó límite de plan gratuito — la organización "Autoconsumo" está en plan Pro). Alfredo terminó creándolo él mismo desde el dashboard, dentro de la organización **Autoconsumo** (`cisduerwcpdtjltqjivo`), y avisó **"creado"**.

**Proyecto nuevo: `qdelfelmvwnehyzfzrav`** (nombre "autocheck", org Autoconsumo, región **us-east-2**, Postgres 17, estado `ACTIVE_HEALTHY`).

### Qué se reconstruyó ahí (vía migration `reconstruye_esquema_autocheck`, aplicada con éxito)
- Tabla `public.leads_autocheck_estaciones` completa (las ~40 columnas: datos generales, combustibles/tanques, permisos, compras/facturación, operación, antecedentes, consentimiento de privacidad, tracking de tier/alertas/interés en CTA, score), con RLS activo y la política `insertar_autenticado` (solo `authenticated` puede insertar — el mismo endurecimiento anti-spam que tenía el proyecto original).
- Función `public.marcar_interes_cta(p_id uuid, p_tipo text)` (`SECURITY DEFINER`) — igual que antes, para que el HTML marque clics en los CTAs sin abrir SELECT/UPDATE de la tabla completa.
- Función `public.contar_autochecks_usuario()` (`SECURITY DEFINER`) — para el banner de "N de tus 3 autochecks gratuitos".
- Secreto `resend_api_key` guardado en **Supabase Vault** (la API key de Resend que Alfredo compartió en el chat — nunca se puso en texto plano en ningún archivo ni tabla legible).
- Función `public.obtener_resend_api_key()` (`SECURITY DEFINER`, permiso de ejecución solo para `service_role`) — para que la Edge Function de envío de correo pueda leer la key sin exponerla nunca al cliente.
- Edge Function `enviar-reporte-autocheck` redesplegada con el código completo y correcto (ver feature de PDF abajo).

### Pasos manuales que le quedan a Alfredo (no reproducibles por Claude)
1. **Volver a poner "Email OTP length" en 8** — Supabase dashboard del proyecto nuevo → Authentication → Sign In/Providers → Email. Por default nace en 6, y el HTML ya está calibrado para 8 dígitos.
2. **Recrear (o proporcionar) la plantilla de correo "Magic link or OTP"** con el diseño de marca, si la tiene guardada en algún lado.
3. **Subir `index.html` a Netlify** — mientras no se haga esto, el sitio en vivo (`autocheck.autoconsumo.mx`) sigue apuntando al proyecto de Supabase que ya no existe y no funcionará para ningún usuario real.

---

## Feature: PDF de reporte + envío automático por correo (construida en Sesión 4, 17-sep-2026)

Alfredo compartió un mockup de 2 páginas y pidió: **"Este es el modelo de PDF que me gustaría que se genere y se envíe por mail"**. Se aclaró con él (vía preguntas de opción múltiple): proveedor de correo = **Resend** (ya tiene cuenta); alcance = **ambas páginas** del mockup; disparo = **automático, inmediatamente al terminar el autocheck** (no un botón manual de "enviarme el PDF").

**Alcance de personalización, aclarado explícitamente por Alfredo:** *"el autocheck es pagina 1 y la otra hojita es la 2. En la hoja 2 solo se personaliza el cuadro de los ok, lo demás es igual para todos, son labels."*
- **Página 1** ("Auto-check", franja naranja): 100% dinámica — score/medidor tipo dona, datos de la instalación, pill de estatus, conteos, cajas de puntos críticos/avisos.
- **Página 2** ("Puntos adecuados"): solo el cuadro verde de fortalezas (apodo + checklist de "OK") es dinámico; todo lo demás (Notas Importantes, caja SAT, caja de protocolos, banner de marca inferior, aviso legal "Noticia de uso") es estático e idéntico para todos los usuarios.

**Remitente:** Alfredo pidió específicamente `autocheck@autoconsumo.mx` como cuenta de envío — así quedó configurado en Resend (`RESEND_FROM_EMAIL`).

### Cómo se construyó (Edge Function `enviar-reporte-autocheck`, Deno + `pdf-lib`)
- Generación del PDF con `pdf-lib` (`npm:pdf-lib@1.17.1`, resuelto por los servidores de build de Supabase — no requiere `npm install` local).
- **Restricción importante que definió el diseño:** el sandbox de Claude no tiene forma de hacer `curl`/`npm install`/renderizar PDFs para verificar visualmente el resultado (red bloqueada para esos hosts). Por eso el PDF se construyó **únicamente con primitivas de `pdf-lib` sin ambigüedad** (rectángulos, círculos, líneas, texto con fuentes estándar, rotación con ancla matemática) y se evitó todo lo que hubiera necesitado calibración visual empírica: paths SVG, esquinas redondeadas, glifos Unicode tipo ✓/✕/⚠ (las fuentes estándar de pdf-lib solo garantizan Latin-1, así que los íconos de check se dibujan a mano con líneas).
- El medidor tipo dona del score se construye con una técnica de "anillo de ticks": ~44 rectángulos delgados posicionados por trigonometría y rotados alrededor de su propia esquina, coloreados según el porcentaje.
- El logo "a" se reincrustaba en el PDF, en la esquina de la página 1 y en el banner de marca de la página 2. **18-sep-2026 (sesión 6): se quitó de ambos lugares** — Alfredo reportó que se veía "empastelado" en chico y confirmó que está bien prescindir de él ahí.
- **`enviarCorreo()`** arma el email vía la API HTTP de Resend, con el PDF adjunto en base64, `from: autocheck@autoconsumo.mx`.
- La API key de Resend se obtiene en cada invocación vía `obtener_resend_api_key()` (RPC con Vault), nunca hardcodeada.
- Modo `preview: true` en el payload permite pedir el PDF crudo (sin enviar correo) para depuración futura.

### Cableado del lado del cliente
El HTML llama a la función justo después de insertar el lead exitosamente en `leads_autocheck_estaciones`, de forma "fire-and-forget" (no bloquea la pantalla de resultado si el correo tarda o falla):
```js
supabaseClient.functions.invoke('enviar-reporte-autocheck', { body: { correo, nombre_contacto, empresa, nombre_instalacion, estado, combustibles, cantidad_tanques, capacidad_tanques, antiguedad_anios, porcentaje_puntaje, tier_resultado, elegible_registro, alertas_rojas, alertas_amarillas, fortalezas } }).catch(...)
```

### ⚠️ Sin probar end-to-end limpio todavía
Por las restricciones de red del sandbox, nunca se pudo invocar la función desde el propio sandbox de Claude — pero en la sesión 6 (18-sep-2026) Alfredo sí probó en vivo y mandó capturas del PDF real y de los correos reales recibidos, lo cual permitió el batch de fixes de esa sesión. Sigue pendiente la prueba end-to-end completa y limpia después de aplicar los últimos fixes (HTML en Netlify + ajustes de Auth en el dashboard).

---

## Sesión 3 — 16-sep-2026 — batch de fixes de UX/copy reportados por Alfredo probando el sitio en vivo
Alfredo probó el sitio en vivo (`https://autocheck.autoconsumo.mx`) y mandó una serie de bugs/ajustes por chat, cada uno con captura de pantalla.

Fixes aplicados en esta sesión:
1. **"Quiero suscribirme" cuando el correo no es suscriptor:** en `#pantalla-acceso`, si el correo no se reconoce como suscriptor existente, el botón deja de decir "Enviar código" y cambia a **"QUIERO SUSCRIBIRME"**.
2. **Aviso de tanques vs. combustibles:** ahora `validarNumTanquesVsCombustibles()` solo dispara la advertencia cuando hay **más de un** combustible seleccionado.
3. **Capacidad de tanque:** la etiqueta corregida a **"(en litros)"**; placeholder cambiado a **"Ej. 30000"**.
4. **Copy del Paso 7** reemplazado con el texto exacto que dio Alfredo.
5. **Validación dura de tanques por combustible:** `pasoValido()` **bloquea** el botón "Siguiente" del Paso 2 si la cantidad de tanques declarada es menor al número de combustibles marcados.
6. **"Puntos a revisar antes del registro" personalizado:** cada punto listado va precedido por la pregunta que lo originó, en negritas.
7. **Conteo real de puntos críticos:** ahora cuenta las alertas rojas reales y dice "Tienes N puntos críticos que atender" cuando son más de una.
8. **Copy de la pantalla de resultado:** se quitó la promesa de "Un asesor te contactará". Título unificado a "RESULTADO DE TU AUTOCHECK".
9. **Ícono de la pantalla de resultado:** siempre muestra el logo real de la marca (la "a"), sin importar el resultado.
10. **Favicon agregado**: se agregó `<link rel="icon">` en el `<head>` usando el mismo logo "a" (data URI).

### Rediseño completo de la pantalla de resultado (16-sep-2026, más tarde en la sesión 3)
Alfredo mandó un mockup de cómo se imagina la pantalla final de resultado. Se aclararon dos decisiones con él antes de construir:
- **CTA único "AGENDA UNA CONSULTA"** (misma liga de HubSpot Meetings) para los tres niveles, en vez de los botones diferenciados que había antes (Ir al registro CNE / precheck / asistencia personalizada).
- **Sí construir "Tus Datos" y "Fortalezas y Checks"** (antes no existían).

Implementado en el HTML (función `renderResultadoCompleto`):
- **Medidor tipo dona** (CSS con `conic-gradient` + máscara radial) mostrando el % grande en el centro.
- **Pill de estatus**: "REGISTRO NO VIABLE POR AHORA" (rojo, ajustado 17-sep) si aplica bloqueo duro, "TIENES PUNTOS CRÍTICOS QUE ATENDER" (rojo) si hay alertas rojas, "TIENES PUNTOS A REVISAR" (amarillo) si hay alertas amarillas, o "ESTÁS EN CONDICIONES DEL REGISTRO" (verde).
- **Conteos rápidos**, **"Tus Datos"**, **tres cajas de color** (roja/amarilla/verde), **"Fortalezas y Checks"** (mapa `FORTALEZAS_TEXTO`).
- **"Hemos enviado este score a tu correo electrónico."**
- **Mensaje personalizado por nivel**, con el nombre de pila del contacto y el nombre/apodo de la instalación.

### Ajustes rápidos después del rediseño (17-sep-2026)
- Copy de la pill "no elegible" → "REGISTRO NO VIABLE POR AHORA".
- **Bug real: el "acceso directo" (suscriptor recurrente) no podía diferenciar instalaciones.** Fix: se movió el campo "Nombre o apodo de la instalación" del Paso 1 al Paso 2 (que sí se muestra en ambos flujos).

### Pendiente: recuperar/consultar autochecks anteriores
Alfredo preguntó si un usuario puede recuperar sus autochecks anteriores — hoy no puede. **Decisión explícita de Alfredo: no construirlo todavía.**

### Aviso de autochecks gratuitos usados (17-sep-2026) — implementado
Banner tras el OTP: "Has utilizado X de tus 3 autochecks gratuitos." + botón deshabilitado "¿Necesitas más? Adquiere Autocheck-Plus". Puramente informativo, no bloquea nada.

**Todavía sin resolver / abierto de esta sesión:**
- Discrepancia de precio en el Payment Link de "asistencia personalizada": el checkout en vivo mostró $17,397.97 MXN, no los $12,500/$9,999 documentados.
- No se ha confirmado si Alfredo ya terminó de configurar Stripe/HubSpot para que el Payment Link cobre correctamente.

## Sesión pausada — 15-sep-2026 (sesión 2)
Se pausó con la capa de "siguientes pasos" ya construida y desplegada, y a medio cablear los CTAs de pago.

## Estado: ✅ EN VIVO Y FUNCIONANDO (17-sep-2026)
- **Deploy publicado el 13-sep-2026 a la 1:11 PM.**
- **15-sep-2026: CONFIRMADO visualmente** — `https://autocheck.autoconsumo.mx` con SSL válido.
- **17-sep-2026: el proyecto de Supabase original (`vuupbdfcyiulhqwemxya`) fue borrado por accidente — ver Sesión 4.**
- Netlify site: `autocheck-autoconsumo` (site_id `ea75d597-85ea-49e6-b876-bccf29ddbbcf`, team_id `69f9487d28f19fceabd384d3`).

## Dominio propio — configurado en Akky
El dominio `autoconsumo.mx` está registrado en **Akky**. `autocheck.autoconsumo.mx` está configurado como CNAME apuntando a `autocheck-autoconsumo.netlify.app.` (sin delegar nameservers completos, para no romper correo/otros subdominios).

## Decisión de arquitectura: un solo dominio
Todo vive en `autocheck.autoconsumo.mx`, con el flujo nuevo/recurrente resuelto dentro de la misma página.

## Rediseño: home con flujo separado para nuevos vs. recurrentes — ✅ IMPLEMENTADO Y PUBLICADO
**Mockup de referencia (Claude Design canvas):** https://claude.ai/code/artifact/fc004b6c-eced-422f-ac0e-c400486af571

Flujo implementado:
1. Portada (`#portada`) con dos tarjetas: "¿Primera vez aquí? → Suscríbete gratis" y "¿Ya tienes suscripción? → Entra directo al Autocheck".
2. Suscripción nueva: `signInWithOtp({email, options:{shouldCreateUser:true, data:{empresa, nombre_contacto, whatsapp}}})`.
3. Acceso directo: `signInWithOtp({email, options:{shouldCreateUser:false}})`.
4. Al verificar el OTP se distingue el origen (`flujoActual`) y se precargan datos para suscriptores recurrentes.
5. La pantalla de OTP, reenvío con cooldown y "Corregirlo" sirven a ambos flujos.

**Bug real corregido de paso:** el OTP de Supabase está en 8 dígitos (no 6) — corregido `maxlength`, placeholder, ancho y validación.

## Conexión con Supabase
- **Proyecto actual: `qdelfelmvwnehyzfzrav`** (org Autoconsumo `cisduerwcpdtjltqjivo`, región us-east-2) — recreado el 17-sep-2026.
- Proyecto original (ya inexistente, solo referencia histórica): `vuupbdfcyiulhqwemxya`.
- Tabla `leads_autocheck_estaciones`, RLS activo.
- El conector MCP de Supabase y de Netlify de Alfredo están enlazados a esta cuenta de Claude.
- **18-sep-2026 (sesión 6): repo de GitHub creado — `https://github.com/autoconsumo-mx/autocheck` — ver sección arriba.**
- **20-sep-2026 (sesión 7): repo conectado a Netlify (deploy automático); Site URL, Redirect URLs y Custom SMTP vía Resend corregidos en Authentication — ver sección de sesión 7 arriba.**

## Verificación por OTP (anti-spam)
`supabase.auth.signInWithOtp(...)` → pantalla de código → `supabase.auth.verifyOtp({email, token, type:'email'})`. Reenvío con cooldown de 60s.

**Longitud del OTP: 8 dígitos (decisión deliberada de Alfredo).** Supabase → Authentication → Sign In/Providers → Email → "Email OTP length" = 8.

**Correos de Auth (OTP, etc.) ahora salen por Custom SMTP vía Resend (sesión 7, 20-sep-2026)** — host `smtp.resend.com`, username `resend` (texto literal, no derivado de la cuenta), remitente personalizado en vez del mailer default de Supabase. Esto resolvió el rate limit bajo del mailer default y permite personalizar subject/remitente en Authentication → Email Templates.

**Decidido en sesión 8 (21-sep-2026) — Opción A, con auto-envío del OTP al confirmar:** cuando "Confirm email" está activo, Supabase manda el template "Confirm sign up" (solo link, sin código) para el alta nueva. Alfredo decidió: el usuario primero confirma su correo con ese link (Opción A, dos pasos), pero en cuanto hace click, el sitio le manda de inmediato el primer código OTP (sin que tenga que hacer nada más) — así el paso de "confirmar" y el de "obtener acceso" se sienten como un solo flujo continuo para el usuario, aunque técnicamente sean dos correos.

Implementado en [index.html:939-946](index.html:939) (captura los parámetros del link antes de que Supabase los consuma) y [index.html:1894-1925](index.html:1894) (`manejarLlegadaConfirmacionCorreo`): al volver del link de confirmación, dispara automáticamente `signInWithOtp(shouldCreateUser:false)` y muestra la pantalla de OTP. Commit `710ace0`, ya en `main`/producción — es un cambio aditivo y no rompe nada existente si algo no calza (simplemente no dispara el auto-OTP).

**Pendiente manual de Alfredo:** pegar esta plantilla en Supabase Dashboard → Authentication → Email Templates → **Confirm signup** (usa el mismo estilo visual que la plantilla de OTP ya pegada):
```html
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0D1B2A;color:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#112236;padding:24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08)">
    <img src="https://kzinwngzpgjorwwnypoq.supabase.co/storage/v1/object/public/assets/autoconsumo-200.png" width="56" height="56" alt="autoconsumo.mx" style="display:block;margin:0 auto;border-radius:50%"/>
    <div style="margin-top:8px;font-size:13px;color:#ABD3FF">Auto-check · Autoconsumo</div>
  </div>
  <div style="padding:32px 24px">
    <p style="font-size:16px;font-weight:600;margin:0 0 24px">¡Hola!</p>

    <p style="font-size:14px;color:#ffffff;margin:0 0 4px;text-align:center">Estamos confirmando tu correo para tu registro.</p>
    <p style="font-size:14px;color:#ffffff;font-weight:600;margin:0 0 24px;text-align:center">¡Todo listo!</p>

    <p style="font-size:13px;color:#ABD3FF;line-height:1.6;margin:0 0 20px;text-align:center">Haz click para recibir tu clave de acceso al Autocheck.<br>Te enviaremos un nuevo correo con tu código.</p>

    <div style="text-align:center;margin:0 0 24px">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#F6B72B;color:#0D1B2A;font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:8px">CLICK</a>
    </div>

    <div style="border-top:1px solid rgba(255,255,255,0.08);margin:0 0 20px;"></div>

    <p style="font-size:12px;color:#8A9BB0;line-height:1.6;margin:0">Si no solicitaste este registro, puedes eliminar e ignorar este mensaje. Tu cuenta permanece segura.</p>
  </div>
  <div style="background:#112236;padding:16px 24px;text-align:center;border-top:1px solid rgba(255,255,255,0.08)">
    <p style="font-size:11px;color:#8A9BB0;margin:0">© 2026 autoconsumo.mx · Fuel Experts</p>
  </div>
</div>
```
El botón usa `{{ .ConfirmationURL }}` (el merge tag correcto de Supabase para este template — es lo que dispara la confirmación real al hacer click). Pegar la plantilla es opcional para que el código funcione (sin ella, el link de confirmación sigue funcionando con el template genérico de Supabase, solo que sin el estilo de marca) — pero si no se pega, el correo se ve genérico, no de marca.

**✅ Verificado en vivo el mismo 21-sep-2026 (más tarde en la sesión 8), con un alta real de Alfredo (`contenidosfactory@gmail.com`).** La hipótesis del flujo implícito (hash) era correcta — confirmado tanto por los logs (`login_method: "implicit"`) como por captura de pantalla del propio Alfredo: click en "Confirm email address" → aterrizó directo en la pantalla "Verifica tu correo" → llegó el segundo correo con la CLAVE de 8 dígitos, ya con el diseño de marca correcto (plantilla "Magic link or OTP" ya pegada en sesiones anteriores). Secuencia en `auth_logs`:
```
06:39:28  /otp      200   user_confirmation_requested   (correo "Confirm signup" enviado)
06:40:43  /verify   303   user_signedup                 (click en el link de confirmación)
06:40:43  Login     login_method: implicit              (sesión establecida vía hash — confirma la hipótesis)
06:40:44  /user     200                                  (el código nuevo lee la sesión)
06:40:45  /otp      200   user_recovery_requested        (segundo OTP auto-enviado — funcionó)
```
**Pendientes menores encontrados en esta prueba — los tres ya resueltos por Alfredo el mismo 21-sep-2026 (todos dashboard-only, sin código):**
1. ~~El correo de "Confirm signup" sin plantilla de marca (body y subject en inglés genérico)~~ — ✅ Alfredo pegó el HTML de marca + subject en español en Authentication → Email Templates → Confirm signup.
2. ~~Subject de "Magic Link" en inglés~~ — ✅ Alfredo lo cambió a español (el body ya estaba bien desde antes).
3. ~~Verificar SPF/DKIM/DMARC en Resend~~ — ✅ confirmado por captura: `autoconsumo.mx` aparece "Verified" en Resend → Domains, dominio de 4 meses de antigüedad. Esto descarta que el spam fuera por DNS/reputación nueva del dominio — la causa más probable era simplemente lo genérico/mínimo del correo default de Supabase (un solo link, poco texto, patrón típico de spam para Gmail), que ya no aplica con la plantilla de marca pegada. **No confirmado con una prueba real nueva todavía** — vale la pena revisar si el próximo correo de "Confirm signup" ya no cae en spam.

**Anomalía encontrada, sin explicación clara — vigilar, no se intentó arreglar con un solo dato:** el primer intento de enviar el OTP de alta para este correo nuevo falló con `422 "Signups not allowed for otp"` (`error_code: otp_disabled`) a las 06:38:59; el mismo correo, sin que Alfredo tocara nada en el dashboard, sí pudo registrarse 29 segundos después. Un solo caso, no reproducido más veces hoy. Si vuelve a pasarle a un suscriptor real, conviene que el botón "Siguiente" reintente una vez automáticamente antes de mostrarle el error genérico — no implementado todavía (falta más de un caso para justificarlo).

**RLS:** solo `authenticated` puede insertar en `leads_autocheck_estaciones`.

## Consentimiento / Aviso de Privacidad
Checkbox obligatorio al final del paso 1 (solo suscriptores nuevos). Columnas: `acepta_aviso_privacidad`, `aviso_privacidad_version` (`'2026-09-07'` — actualizar la constante `AVISO_PRIVACIDAD_VERSION` en el HTML si cambia el aviso).

## Entregables
- `index.html` (repo GitHub) — wizard de 7 pasos + portada + gate de OTP + consentimiento + pantalla de resultado + envío automático de PDF por correo + stepper de círculos numerados.
- `supabase/functions/enviar-reporte-autocheck/index.ts` (v3, ACTIVE) — genera el PDF de 2 páginas y lo envía por Resend.
- `supabase_setup.sql` (proyecto Claude Docs, no incluido aún en este repo) — desactualizado, pendiente de actualizar.

## Estructura del wizard (7 pasos, después de la portada)
1. Datos generales — empresa, tu nombre, correo, WhatsApp, checkbox de Aviso de Privacidad. → gate de OTP.
2. Combustible e instalación — combustibles, cantidad de tanques, capacidad por tanque, antigüedad, nombre/apodo de la instalación.
3. Permisos y documentación.
4. Compras y facturación.
5. Operación y uso.
6. Antecedentes regulatorios.
7. Interés — permiso definitivo después del Registro CNE, por cuenta o con acompañamiento.

## Sistema de puntaje (score)
9 campos de datos otorgan 10 puntos fijos cada uno = 90 base. 20 preguntas Sí/No variables suman entre -140 y +200. Rango total: **-50 a 290 puntos**, normalizado a 0–100% (paleta: crítico #d03b3b, serio #ec835a, advertencia #fab219, bueno #0ca30c).

## Lógica de elegibilidad (bloqueos duros)
`elegible_registro = false` si: ya tiene permiso vigente, o no surte únicamente a vehículos de la misma empresa, o la instalación no está operando actualmente.

## Clasificación "lead plus"
"Con acompañamiento" en la última pregunta → `lead_plus = true` (uso interno, sin impacto en puntaje).

## Monetización y pagos
- **Arquitectura decidida:** Tarjeta → Stripe Checkout; SPEI → API de Órdenes de Mercado Pago. Reconfirmado sin cambios en sesión 8 (22-sep-2026) — Alfredo consideró usar la función de "Transferencias bancarias" de Stripe (que cubre México) para SPEI en vez de Mercado Pago, pero decidió dejarlo como está documentado.
- **Límite gratis: ✅ implementado y en producción desde sesión 8 (21-sep-2026).** 3 autochecks gratis por correo, ya bloqueado de verdad (antes era solo informativo) — ver "Autocheck Plus" abajo.
- **Pipeline "REGISTRO CNE" en HubSpot:** ✅ creado en sesión 8 (21-sep-2026), aprobado por Alfredo — [pipeline id `936463482`](https://app.hubspot.com/pipelines-settings/51056347/object/0-3/936463482), objeto Deal, 7 etapas: Miembro freemium (registro) → Autocheck generado → Compra (Autocheck Plus / Precheck Pro) → Sesión agendada → Servicio prestado → Registro generado (ganado) / Declinado-no procede (perdido). Refleja el nuevo modelo de membresía freemium que Alfredo está armando (boletines + cupo de autochecks gratis). **Hueco técnico real, sin construir todavía:** no existe ninguna sincronización entre los leads de Supabase/el cupo de Autocheck Plus y HubSpot — los deals de este pipeline habría que crearlos/avanzarlos a mano o construir un webhook nuevo (distinto del webhook de cobro de Autocheck Plus, que sí ya existe — ver abajo).
- **CTAs:** "Agenda una consulta" resuelto (`https://meetings.hubspot.com/autoconsumo/registro_cne`); Payment Link de asistencia personalizada con discrepancia de precio sin resolver (`https://payments-na1.hubspot.com/payments/9XQrvkQHJGqY6?referrer=PAYMENT_LINK` — sí tiene cobro real, $17,397.97 MXN con 15% de descuento aplicado; falta confirmar con Alfredo si ese es el monto correcto o si la discrepancia es con otro producto — quedó sin resolver, "son varios productos").
- **Decisión de arquitectura de pagos:** HubSpot Payment Links (vía Stripe conectado) para precheck/asistencia (venta asistida); pasarela propia (Stripe + Mercado Pago) para lo que viva dentro del Autocheck mismo.

### Autocheck Plus (+5 autochecks) — ✅ construido y en producción, sesión 8 (21-sep-2026)
Al agotar los 3 autochecks gratis, el sitio ahora bloquea de verdad la entrada al wizard (tanto para alta nueva como para "acceso directo") y muestra una pantalla de compra con la ilustración y copy que dio Alfredo, precio $2,500 MXN tachado → $1,499 MXN "precio especial para miembros" (IVA incluido), botón "COMPRA AUTOCHECK PLUS".
- **Backend (Supabase, proyecto `qdelfelmvwnehyzfzrav`):** tabla `autocheck_membresias` (correo → cupo_extra, sin policies de RLS — solo accesible vía funciones); `obtener_cupo_extra_usuario()` (lectura, cliente autenticado); `otorgar_cupo_extra_autocheck_plus(correo, cantidad)` (suma atómica, solo service_role); Edge Function `webhook-compra-plus` (ACTIVE, `verify_jwt: false`, protegida con un secreto compartido guardado en Vault como `webhook_compra_plus_secret`) — recibe el aviso de pago y otorga +5 cupo, acumulable en compras repetidas. Probado end-to-end vía `curl` (incluyendo rechazo con secreto incorrecto) antes de desplegar.
- **Frontend (`index.html`):** `verificarOtp()` ahora llama `obtenerUsoAutochecks()` (cuenta usados + cupo extra) antes de dejar entrar al wizard; si `usados >= 3 + cupoExtra`, muestra `#pantalla-limite-alcanzado` en vez del formulario.
- **Pendiente real, bloqueante para que la compra sea 100% automática:** Alfredo todavía no crea el Producto ni el Payment Link de "Autocheck Plus" en HubSpot, ni el Workflow que dispara el webhook al completarse el pago — instrucciones exactas (URL del webhook + secreto + payload) ya entregadas en chat. Mientras tanto el botón de compra apunta a un `mailto:` placeholder (mismo patrón que `urlPrecheck` antes de esta sesión).
- Commits: `7fa22d0` (backend + bloqueo), `a0295e7` (rediseño con ilustración/copy), `84c5147` (se quitó una mención cruzada a Precheck Pro que se agregó de más — ver nota abajo).

### Precheck Pro — pendiente nuevo, NO incluir en el sitio todavía (meta: antes del 25-sep-2026)
Alfredo definió un producto nuevo y distinto de "precheck" (el viejo, $9,499/año, ya obsoleto): **Precheck Pro** — el usuario sube sus documentos reales y se validan con participación de abogados + IA, todo digital, evaluación profunda entregada en 48 horas. Precio $25,000 MXN normal / $14,999 MXN precio miembros (IVA incluido). **Vive en su propio portal** (no en `autocheck.autoconsumo.mx`) — Autocheck solo lo ofrecerá como cross-sell ("vía de maximización") una vez que ese portal exista.
**Explícitamente NO incluir todavía:** se había agregado por error un link a "Precheck Pro" en la pantalla de Autocheck Plus (sesión 8) y Alfredo pidió quitarlo — commit `84c5147` lo revirtió. Meta de Alfredo: incorporarlo antes del 25-sep-2026. Cuando se retome: el portal de Precheck Pro es un proyecto aparte (no construir aquí), solo agregar el cross-sell/link desde Autocheck una vez que exista.

## Dashboard interno (staff) — spec pendiente, NO empezado a construir
Alfredo compartió un mockup el 21-sep-2026 (sesión 8) de un dashboard interno que quiere para sí mismo — ver imagen guardada en `docs/mockups/dashboard-interno-mockup.png`. **Solo se anotó el requerimiento; a petición explícita de Alfredo ("no rompas el flujo de trabajo") no se tocó código ni se empezó a construir nada de esto todavía.** Queda ligado al pendiente #6 de la lista de abajo.

Lectura del mockup, campo por campo (para cuando se retome):
- **Encabezado:** logo + "autoconsumo.mx" + "Autocheck de Registro".
- **Tarjeta "Usuarios y Autochecks":** Total de suscriptores; Autochecks ejecutados; Usuarios con 1 autocheck / con 2 / con 3+ (desglose por cuántos autochecks ha hecho cada correo — relacionado con `contar_autochecks_usuario()`, ya existente).
- **Tarjeta "Calidad de autochecks":** Total de autochecks; Con alerta crítica; Con advertencias; Sin alertas ni advertencias (cruza con `tier_resultado`/`alertas_rojas`/`alertas_amarillas`, ya existentes en la tabla).
- **Tarjeta "Resultados":** conteo de leads por `interes_cta` elegido — "Autocheck plus", "PreCheck-Pro", "Agenda Consulta" (los valores exactos de `interes_cta` que usa `index.html` habría que confirmarlos contra el código antes de construir esto — los nombres del mockup son aproximados/de negocio, no necesariamente el string literal guardado en la columna).
- **Tarjeta "Regiones":** conteo de leads por estado (columna `estado`) — el mockup muestra "Nuevo León", "Chihuahua", "Estado de México" como ejemplo.
- **Tabla "Miembros/Usuarios"** con link "VER/EDITAR": una fila por suscriptor (no por autocheck individual), columnas — Nombre, Correo, fecha de Alta, tipo de Member (`free`/`plus`, probablemente ligado a `lead_plus` o a una futura tabla de suscripciones/membresías — **no existe hoy una noción de "usuario" por encima de los leads individuales**, así que esto requeriría diseño de datos nuevo), cantidad de Autochecks ("2 DE 3" sugiere un límite/cupo por plan, concepto que no existe todavía en el sistema), Nick (alias del sitio/instalación — probablemente `nombre_instalacion`), Edo/Mpio (estado/municipio — hoy solo existe `estado`, no hay columna de municipio), y columnas "G D LP" sin leyenda visible en el mockup (posible: Gasolina/Diésel/LP-gas, o alguna otra clasificación — **confirmar con Alfredo qué significan antes de construir**).

**Implicaciones de arquitectura a resolver antes de construir (no triviales):**
1. Requiere una política de SELECT en `leads_autocheck_estaciones` para `authenticated` (no existe hoy — ver nota en "Verificación por OTP" arriba) y probablemente un rol/flag de "staff" distinto de un suscriptor normal, para no exponer este dashboard a cualquier correo verificado.
2. El concepto de "Member free/plus" y "cupo de autochecks" (ej. "2 DE 3") no existe en el esquema actual — es una capa de membresía/planes que todavía no está modelada (relacionado con el pendiente #9, "detallar la membresía gold/plus").
3. Faltan columnas (`municipio`) o hay que confirmar qué representan "G D LP" antes de construir las columnas de la tabla.

## Pendiente
1. ~~Subir a Netlify la versión más reciente de `index.html` (o conectar el repo de GitHub a Netlify para que sea automático)~~ — ✅ hecho en sesión 7 (20-sep-2026): repo conectado, deploy automático en cada push a `main`, verificado en vivo dos veces.
2. ~~Ajustes manuales en Supabase Auth (`qdelfelmvwnehyzfzrav`): Site URL correcto + Custom SMTP vía Resend~~ — ✅ hecho en sesión 7.
3. ~~Probar end-to-end limpio la función de envío de PDF/correo tras el fix de Site URL/SMTP~~ — ✅ hecho en sesión 7 (correo de prueba `op@energie.mx`). De paso se encontró y corrigió una API key de Resend inválida en el Vault (independiente del SMTP) y se corrigió una inconsistencia de color entre el medidor del sitio y el del PDF — ver detalle en la sección de sesión 7 arriba.
4. ~~Decidir Opción A vs B para la plantilla "Confirm sign up"~~ — ✅ decidido, codificado, **verificado en vivo** y con los tres ajustes de dashboard ya cerrados en sesión 8 (21-sep-2026): Opción A con auto-envío del OTP al confirmar, probado de punta a punta con un alta real; plantilla+subject de "Confirm signup" y subject de "Magic Link" ya en español; dominio `autoconsumo.mx` verificado en Resend (descarta DNS como causa del spam). Solo falta confirmar con una prueba real nueva que el correo de "Confirm signup" ya no caiga en spam — ver detalle en "Verificación por OTP" arriba.
5. Confirmar que las franjas del medidor y los bloqueos duros reflejan lo que el equipo espera.
6. Construir un dashboard interno (staff) para ver los autochecks — Alfredo compartió un mockup el 21-sep-2026 (sesión 8), ver `docs/mockups/dashboard-interno-mockup.png` y el detalle de campos en "Dashboard interno (staff) — spec pendiente" más abajo. **Todavía no se empezó a construir** — solo quedó anotado el requerimiento, a petición explícita de Alfredo de no interrumpir el flujo de trabajo en curso.
7. Decidir si "acceso directo" sin correo encontrado debe saltar automático a suscripción.
8. Construir la Edge Function que normalice webhooks de Stripe/Mercado Pago.
9. ~~Detallar la membresía "gold"/plus~~ — parcialmente resuelto en sesión 8 (21-sep-2026): "Autocheck Plus" (+5 autochecks, $1,499 MXN miembros) ya definido, construido y en producción — ver "Autocheck Plus" en Monetización y pagos. Sigue sin definir una membresía "gold" más amplia (boletines, etc.) más allá de este cupo extra.
10. ~~Mostrarle a Alfredo la tabla de 7 etapas del pipeline "REGISTRO CNE" para aprobación~~ — ✅ hecho y creado en sesión 8 (21-sep-2026), ver "Monetización y pagos" arriba.
11. Resolver discrepancia de precio de asistencia personalizada (son varios productos, sin desenredar todavía — ver Monetización y pagos); decidir si reintroducir botones de precheck/asistencia por separado del CTA único.
12. ~~Actualizar `supabase_setup.sql`~~ — ✅ hecho en sesión 8 (21-sep-2026): reescrito a partir del esquema real del proyecto (leído vía MCP de Supabase), corrige varias divergencias (política de INSERT es `authenticated`, no `anon`; `capacidad_tanques` es `numeric[]`; faltaban 7 columnas y las funciones RPC `contar_autochecks_usuario`/`marcar_interes_cta`/`obtener_resend_api_key` con sus permisos; la columna `status` del script viejo ya no existe en la tabla real). Se agregó al repo por primera vez como `supabase_setup.sql` (antes vivía solo como archivo local en Downloads).
13. Confirmar con Alfredo si el CTA único reemplaza definitivamente a los tres botones anteriores.
14. Decidir si vale la pena capturar combustible/antigüedad por tanque individual.
15. Recuperar/consultar autochecks anteriores — decidido no construir todavía.
16. ~~Crear/conectar el repositorio de GitHub del proyecto~~ — ✅ hecho en sesión 6; conectado a Netlify en sesión 7.
17. ~~Investigar por qué "acceso directo" no reconoce a un correo que ya tiene autochecks previos reales como suscriptor existente~~ — ✅ investigado y corregido en sesión 8 (21-sep-2026): no era un problema de detección de suscriptor, era un error de SMTP (500) mal clasificado como "no hay suscripción" — ver sección de sesión 8 arriba. Queda pendiente probar el flujo real de acceso directo con `op@energie.mx` para confirmar en vivo.
18. **Nuevo (sesión 8, 21-sep-2026), meta: antes del 25-sep-2026.** Incorporar "Precheck Pro" (documentos reales + validación legal/IA, $25,000/$14,999 MXN miembros, portal propio) como cross-sell desde Autocheck — explícitamente NO incluido todavía (ver "Precheck Pro" en Monetización y pagos). El portal en sí es un proyecto aparte; aquí solo va el link/cross-sell una vez que exista.
19. Completar el lado de Alfredo de Autocheck Plus para que la compra sea 100% automática: crear el Producto + Payment Link en HubSpot, y el Workflow que dispara el webhook (`webhook-compra-plus`) al completarse el pago — instrucciones exactas ya entregadas en chat de la sesión 8. Mientras tanto el botón de compra usa un `mailto:` placeholder.

## Próximos pasos posibles
- Vista interna (tablero) para seguimiento por `status`, `lead_plus`, `alertas_criticas`/`tier_resultado`/`interes_cta`/`puntaje`.
- Reporte de uso / estadísticas del sitio.
- Panel de uso por usuario + upsell a membresía pro/gold.
- Trabajo de marketing para promover el Autocheck entre suscriptores.
- Mockups de tema oscuro con medidor tipo dona y asistente "Nauty" — parcialmente retomado, sin el asistente.
