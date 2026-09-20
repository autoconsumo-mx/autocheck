# Cuestionario Autocheck — instalaciones de autoconsumo de combustible

## Objetivo
Formulario público, tipo wizard (7 pasos), para que empresas con instalaciones de autoconsumo de combustible (diesel, gasolina, GLP, GN — para su propia flota, no venta al público) hagan un autocheck de qué tan lista está su instalación para gestionar su registro regulatorio (SENER/CRE/CNE/ASEA). Las respuestas se guardan en Supabase, incluyendo un puntaje numérico con medidor gráfico. El correo se verifica por OTP antes de dejar avanzar, para filtrar spam, y se pide consentimiento explícito (Aviso de Privacidad) antes de continuar.

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

**Pendiente/no aplicado — plantilla "Confirm sign up":** cuando "Confirm email" está activo, Supabase manda el template "Confirm sign up" (solo link, sin código) en vez de "Magic link or OTP". La liga traía `localhost` — **ya corregido en sesión 7** (Site URL + Redirect URLs + SMTP); falta decidir Opción A vs B para este flujo (ver "Pendiente").

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

## Monetización y pagos (en diseño, nada implementado todavía salvo el envío de PDF)
- **Arquitectura decidida:** Tarjeta → Stripe Checkout; SPEI → API de Órdenes de Mercado Pago.
- **Límite gratis:** por ahora sin límite, ilimitado.
- **"Precheck" $9,499/año:** en desarrollo en otro hilo de Claude, sin página de venta todavía.
- **Pipeline "REGISTRO CNE" en HubSpot:** propuesto (7 etapas), no creado — pendiente aprobación explícita de Alfredo.
- **CTAs:** "Agenda una consulta" resuelto (`https://meetings.hubspot.com/autoconsumo/registro_cne`); Payment Link de asistencia personalizada con discrepancia de precio sin resolver (`https://payments-na1.hubspot.com/payments/9XQrvkQHJGqY6?referrer=PAYMENT_LINK`); "precheck" sin liga todavía.
- **Decisión de arquitectura de pagos:** HubSpot Payment Links (vía Stripe conectado) para precheck/asistencia (venta asistida); pasarela propia (Stripe + Mercado Pago) para lo que viva dentro del Autocheck mismo.

## Pendiente
1. ~~Subir a Netlify la versión más reciente de `index.html` (o conectar el repo de GitHub a Netlify para que sea automático)~~ — ✅ hecho en sesión 7 (20-sep-2026): repo conectado, deploy automático en cada push a `main`, verificado en vivo dos veces.
2. ~~Ajustes manuales en Supabase Auth (`qdelfelmvwnehyzfzrav`): Site URL correcto + Custom SMTP vía Resend~~ — ✅ hecho en sesión 7.
3. ~~Probar end-to-end limpio la función de envío de PDF/correo tras el fix de Site URL/SMTP~~ — ✅ hecho en sesión 7 (correo de prueba `op@energie.mx`). De paso se encontró y corrigió una API key de Resend inválida en el Vault (independiente del SMTP) y se corrigió una inconsistencia de color entre el medidor del sitio y el del PDF — ver detalle en la sección de sesión 7 arriba.
4. Decidir Opción A vs B para la plantilla "Confirm sign up".
5. Confirmar que las franjas del medidor y los bloqueos duros reflejan lo que el equipo espera.
6. Decidir si el equipo interno necesita ver las respuestas desde el portal (staff vs. leads).
7. Decidir si "acceso directo" sin correo encontrado debe saltar automático a suscripción. **Relacionado, nuevo hallazgo en sesión 7:** un correo (`op@energie.mx`) con 2 autochecks reales previos fue rechazado por "acceso directo" como si no fuera suscriptor — posible bug en la lógica de detección de suscriptor existente, sin investigar a fondo todavía.
8. Construir la Edge Function que normalice webhooks de Stripe/Mercado Pago.
9. Detallar la membresía "gold"/plus.
10. Mostrarle a Alfredo la tabla de 7 etapas del pipeline "REGISTRO CNE" para aprobación.
11. Liga de precheck real; resolver discrepancia de precio de asistencia; prueba end-to-end en producción; decidir si reintroducir botones de precheck/asistencia.
12. Actualizar `supabase_setup.sql`.
13. Confirmar con Alfredo si el CTA único reemplaza definitivamente a los tres botones anteriores.
14. Decidir si vale la pena capturar combustible/antigüedad por tanque individual.
15. Recuperar/consultar autochecks anteriores — decidido no construir todavía.
16. ~~Crear/conectar el repositorio de GitHub del proyecto~~ — ✅ hecho en sesión 6; conectado a Netlify en sesión 7.
17. **Nuevo (sesión 7):** investigar por qué "acceso directo" no reconoce a un correo que ya tiene autochecks previos reales como suscriptor existente (ver punto 7).

## Próximos pasos posibles
- Vista interna (tablero) para seguimiento por `status`, `lead_plus`, `alertas_criticas`/`tier_resultado`/`interes_cta`/`puntaje`.
- Reporte de uso / estadísticas del sitio.
- Panel de uso por usuario + upsell a membresía pro/gold.
- Trabajo de marketing para promover el Autocheck entre suscriptores.
- Mockups de tema oscuro con medidor tipo dona y asistente "Nauty" — parcialmente retomado, sin el asistente.
