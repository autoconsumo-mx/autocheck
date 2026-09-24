// Supabase Edge Function: enviar-reporte-autocheck
// Genera el PDF de 2 páginas del Autocheck (igual al mockup de Alfredo) y lo envía
// por correo con Resend. Se invoca desde el cliente justo después de insertar el
// registro en leads_autocheck_estaciones (ver index (2).html).
//
// Requiere que exista, en la base de datos, el secreto 'resend_api_key' en Vault
// y la función public.obtener_resend_api_key() (SECURITY DEFINER, solo service_role).

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_FROM_EMAIL = "autocheck@autoconsumo.mx";
const RESEND_FROM_NAME = "Autocheck · autoconsumo.mx";
const CORREO_INTERNO = "autocheck@mail.autoconsumo.mx";
const LIMITE_AUTOCHECKS_GRATIS = 3;

const ORIGEN_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  google: "Google",
};

function escaparHtml(t: unknown): string {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Poppins (tipografía de la marca) para el encabezado y el banner. Se sirve desde el propio
// sitio (assets/fonts, licencia OFL). Si no se puede descargar, el PDF sale con Helvetica.
const FUENTES_URL = "https://autocheck.autoconsumo.mx/assets/fonts/";
interface Poppins { regular: Uint8Array; bold: Uint8Array }
let poppinsCache: Promise<Poppins | null> | null = null;
function cargarPoppins(): Promise<Poppins | null> {
  if (!poppinsCache) {
    poppinsCache = (async () => {
      try {
        const bajar = async (nombre: string) => {
          const r = await fetch(FUENTES_URL + nombre, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
          return new Uint8Array(await r.arrayBuffer());
        };
        const [regular, bold] = await Promise.all([bajar("Poppins-Regular.ttf"), bajar("Poppins-Bold.ttf")]);
        return { regular, bold };
      } catch (e) {
        console.error("No se pudo cargar Poppins; se usa Helvetica:", e);
        poppinsCache = null; // se reintenta en la siguiente invocación
        return null;
      }
    })();
  }
  return poppinsCache;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const NARANJA = hex("#FF6600");
const NARANJA_OSCURO = hex("#d95500");
const ROJO = hex("#c0392b");
const ROJO_FONDO = hex("#fdecea");
const AMARILLO = hex("#92700a");
const AMARILLO_ACENTO = hex("#F6B72B");
const AMARILLO_FONDO = hex("#fff6dd");
const VERDE = hex("#0ca30c");
const VERDE_FONDO = hex("#e8f7e0");
const NAVY = hex("#17213a");
const GRIS = hex("#6b7280");
const GRIS_CLARO = hex("#9aa0ad");
const CAJA_FONDO = hex("#f4f5f7");
const CAJA_BORDE = hex("#e3e5ea");
const BLANCO = rgb(1, 1, 1);

const W = 595.28;
const H = 841.89;
const M = 40;

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawParagraph(
  page: PDFPage,
  opts: { text: string; x: number; y: number; font: PDFFont; size: number; color: RGB; maxWidth: number; lineHeight: number },
): number {
  const lines = wrapText(opts.font, opts.text, opts.size, opts.maxWidth);
  let cy = opts.y;
  for (const line of lines) {
    page.drawText(line, { x: opts.x, y: cy, size: opts.size, font: opts.font, color: opts.color });
    cy -= opts.lineHeight;
  }
  return cy;
}

function drawRightAligned(page: PDFPage, text: string, opts: { xRight: number; y: number; font: PDFFont; size: number; color: RGB }) {
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, { x: opts.xRight - w, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
}

function drawCentered(page: PDFPage, text: string, opts: { xCenter: number; y: number; font: PDFFont; size: number; color: RGB }) {
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, { x: opts.xCenter - w / 2, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
}

// Texto con espaciado entre letras (pdf-lib no tiene tracking nativo).
function drawTracked(page: PDFPage, text: string, opts: { x: number; y: number; font: PDFFont; size: number; color: RGB; tracking: number }) {
  let x = opts.x;
  for (const ch of text) {
    page.drawText(ch, { x, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
    x += opts.font.widthOfTextAtSize(ch, opts.size) + opts.tracking;
  }
}

function drawCheck(page: PDFPage, opts: { x: number; y: number; size: number; color: RGB; thickness?: number }) {
  const t = opts.thickness ?? 1.6;
  const s = opts.size;
  page.drawLine({ start: { x: opts.x, y: opts.y + s * 0.35 }, end: { x: opts.x + s * 0.38, y: opts.y }, thickness: t, color: opts.color });
  page.drawLine({ start: { x: opts.x + s * 0.38, y: opts.y }, end: { x: opts.x + s, y: opts.y + s * 0.75 }, thickness: t, color: opts.color });
}

function drawBulletList(
  page: PDFPage,
  opts: { items: string[]; x: number; y: number; font: PDFFont; size: number; color: RGB; maxWidth: number; lineHeight: number; gap: number; dotColor: RGB },
): number {
  let cy = opts.y;
  const textX = opts.x + 12;
  for (const item of opts.items) {
    page.drawCircle({ x: opts.x + 2.5, y: cy + opts.size * 0.32, size: 2.2, color: opts.dotColor });
    cy = drawParagraph(page, { text: item, x: textX, y: cy, font: opts.font, size: opts.size, color: opts.color, maxWidth: opts.maxWidth - 12, lineHeight: opts.lineHeight });
    cy -= opts.gap;
  }
  return cy;
}

function drawGauge(
  page: PDFPage,
  opts: { cx: number; cy: number; rInner: number; rOuter: number; pct: number; color: RGB; track: RGB; ticks?: number },
) {
  const ticks = opts.ticks ?? 44;
  const filledCount = Math.round((Math.max(0, Math.min(100, opts.pct)) / 100) * ticks);
  const tickLen = opts.rOuter - opts.rInner;
  const thickness = 4.6;
  for (let i = 0; i < ticks; i++) {
    const t = ticks <= 1 ? 0 : i / (ticks - 1);
    const angleDeg = 180 - t * 180;
    const angleRad = (angleDeg * Math.PI) / 180;
    const col = i < filledCount ? opts.color : opts.track;
    const px = opts.cx + opts.rInner * Math.cos(angleRad) + (thickness / 2) * Math.sin(angleRad);
    const py = opts.cy + opts.rInner * Math.sin(angleRad) - (thickness / 2) * Math.cos(angleRad);
    page.drawRectangle({ x: px, y: py, width: tickLen, height: thickness, rotate: degrees(angleDeg), color: col });
  }
}

// Estrella de 5 puntas (viñeta de la caja de protocolos).
function drawStar(page: PDFPage, opts: { cx: number; cy: number; r: number; color: RGB }) {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const ang = ((-90 + k * 36) * Math.PI) / 180;
    const r = k % 2 === 0 ? opts.r : opts.r * 0.45;
    pts.push(`${(r * Math.cos(ang)).toFixed(2)} ${(r * Math.sin(ang)).toFixed(2)}`);
  }
  page.drawSvgPath(`M ${pts.join(" L ")} Z`, { x: opts.cx, y: opts.cy, color: opts.color });
}

// Barritas decorativas del encabezado (réplica del diseño de Alfredo): píldoras horizontales
// en 4 renglones. Coordenadas del diseño original en px (x inicio, x fin, renglón).
const BARRAS_HEADER: Array<[number, number, number]> = [
  [188, 426, 0],
  [206, 277, 1], [286, 464, 1],
  [217, 254, 2], [263, 441, 2],
  [232, 328, 3], [336, 403, 3],
];
function drawHeaderBars(page: PDFPage, opts: { xRight: number; yCenter: number; height: number; color: RGB }) {
  const alturaDiseno = 25 + 3 * 37; // 4 renglones de 25 px separados cada 37 px
  const s = opts.height / alturaDiseno;
  const x0 = opts.xRight - (464 - 188) * s;
  const yTop = opts.yCenter + opts.height / 2;
  const h = 25 * s;
  for (const [xa, xb, fila] of BARRAS_HEADER) {
    const x = x0 + (xa - 188) * s;
    const w = (xb - xa) * s;
    const y = yTop - fila * 37 * s - h;
    page.drawRectangle({ x: x + h / 2, y, width: w - h, height: h, color: opts.color });
    page.drawCircle({ x: x + h / 2, y: y + h / 2, size: h / 2, color: opts.color });
    page.drawCircle({ x: x + w - h / 2, y: y + h / 2, size: h / 2, color: opts.color });
  }
}

function footer(page: PDFPage, font: PDFFont) {
  drawCentered(page, "POWERED BY REGNAUTILUS©", { xCenter: W / 2, y: 22, font, size: 7.5, color: GRIS_CLARO });
  drawCentered(page, "www.autoconsumo.mx", { xCenter: W / 2, y: 12, font, size: 7.5, color: GRIS_CLARO });
}

interface Payload {
  correo: string;
  nombre_contacto: string;
  empresa: string;
  nombre_instalacion: string | null;
  estado: string;
  combustibles: string[];
  cantidad_tanques: number;
  capacidad_tanques: number[];
  antiguedad_anios: number;
  porcentaje_puntaje: number;
  tier_resultado: "critico" | "atencion" | "listo";
  elegible_registro: boolean;
  alertas_rojas: string[];
  alertas_amarillas: string[];
  fortalezas: string[];
  fecha?: string;
  preview?: boolean;
}

const plural = (n: number, uno: string, varios: string) => (Number(n) === 1 ? uno : varios);

function fechaHoy(): string {
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${meses[d.getMonth()]}-${d.getFullYear()}`;
}

// Cada alerta llega como "Situación. Consejo." (el sitio antepone la situación al consejo).
// Se separa en la primera oración para pintar la situación en negritas y el consejo debajo.
function separarAlerta(texto: string): [string, string] {
  const i = texto.search(/[.!?:]\s/);
  if (i < 0) return [texto.trim(), ""];
  return [texto.slice(0, i + 1).trim(), texto.slice(i + 2).trim()];
}

// Tipografía tipo "estado de cuenta": chica y compacta.
const T = { cuerpo: 8, titulo: 10.5, lh: 10 };
const PIE_RESERVADO = 40; // espacio que se deja libre arriba del pie de página

interface Op { text: string; x: number; dy: number; font: PDFFont; size: number; color: RGB }

// Caja de alertas (roja o amarilla): primero se mide, después se dibuja, para que el fondo
// siempre cubra todo el texto y se pueda brincar de página si no cabe.
function layoutAlertBox(
  opts: { titulo: string; intro: string; items: string[]; cierre: string[]; fontReg: PDFFont; fontBold: PDFFont; dotColor: RGB },
) {
  const pad = 16;
  const x = M + pad;
  const maxW = W - 2 * M - 2 * pad;
  const ops: Op[] = [];
  const dots: number[] = [];
  let dy = opts.intro ? 34 : 32;
  for (const l of wrapText(opts.fontBold, opts.intro, T.cuerpo, maxW)) {
    ops.push({ text: l, x, dy, font: opts.fontBold, size: T.cuerpo, color: GRIS });
    dy += T.lh;
  }
  if (opts.intro) dy += 4;
  for (const item of opts.items) {
    const [situacion, consejo] = separarAlerta(item);
    dots.push(dy);
    for (const l of wrapText(opts.fontBold, situacion, T.cuerpo, maxW - 12)) {
      ops.push({ text: l, x: x + 12, dy, font: opts.fontBold, size: T.cuerpo, color: NAVY });
      dy += T.lh;
    }
    if (consejo) {
      for (const l of wrapText(opts.fontReg, consejo, T.cuerpo, maxW - 12)) {
        ops.push({ text: l, x: x + 12, dy, font: opts.fontReg, size: T.cuerpo, color: NAVY });
        dy += T.lh;
      }
    }
    dy += 5;
  }
  dy += 2;
  for (const linea of opts.cierre) {
    for (const l of wrapText(opts.fontBold, linea, T.cuerpo, maxW)) {
      ops.push({ text: l, x, dy, font: opts.fontBold, size: T.cuerpo, color: NAVY });
      dy += T.lh;
    }
  }
  const height = dy - T.lh + 14;
  return { ops, dots, height, titulo: opts.titulo };
}

function drawAlertBox(
  page: PDFPage,
  top: number,
  box: ReturnType<typeof layoutAlertBox>,
  estilo: { fondo: RGB; acento: RGB; icono: RGB; fontBold: PDFFont },
) {
  const pad = 16;
  page.drawRectangle({ x: M, y: top - box.height, width: W - 2 * M, height: box.height, color: estilo.fondo });
  page.drawRectangle({ x: M, y: top - box.height, width: 3, height: box.height, color: estilo.acento });
  page.drawCircle({ x: M + pad + 5, y: top - 15, size: 6.5, color: estilo.icono });
  page.drawText("!", { x: M + pad + 5 - 1.4, y: top - 18.2, size: 8.5, font: estilo.fontBold, color: BLANCO });
  page.drawText(box.titulo, { x: M + pad + 18, y: top - 18.5, size: T.titulo, font: estilo.fontBold, color: NAVY });
  for (const dy of box.dots) page.drawCircle({ x: M + pad + 2.5, y: top - dy + T.cuerpo * 0.32, size: 1.8, color: estilo.icono });
  for (const op of box.ops) page.drawText(op.text, { x: op.x, y: top - op.dy, size: op.size, font: op.font, color: op.color });
}

// Quita lo que Helvetica no puede dibujar (emojis, símbolos raros): sin esto pdf-lib truena
// y el cliente se queda sin reporte.
function limpiarPayload(payload: Payload, font: PDFFont): Payload {
  const permitidos = new Set(font.getCharacterSet());
  const limpiar = (t: unknown) =>
    typeof t === "string"
      ? [...t.normalize("NFC")].filter((ch) => permitidos.has(ch.codePointAt(0)!)).join("").replace(/\s+/g, " ").trim()
      : t;
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) limpio[k] = Array.isArray(v) ? v.map(limpiar) : limpiar(v);
  return limpio as unknown as Payload;
}

async function buildAutocheckPdf(payloadOriginal: Payload, poppins: Poppins | null = null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const payload = limpiarPayload(payloadOriginal, fontReg);
  let marcaReg = fontReg;
  let marcaBold = fontBold;
  if (poppins) {
    doc.registerFontkit(fontkit);
    marcaReg = await doc.embedFont(poppins.regular, { subset: true });
    marcaBold = await doc.embedFont(poppins.bold, { subset: true });
  }

  const nick = (payload.nombre_instalacion || payload.empresa || "tu instalación").toUpperCase();
  const fecha = payload.fecha || fechaHoy();

  const p1 = doc.addPage([W, H]);

  const headerH = 128;
  p1.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: NARANJA });
  drawHeaderBars(p1, { xRight: W - 14, yCenter: H - headerH * 0.47, height: headerH * 0.55, color: hex("#ff7a26") });

  p1.drawText("Auto-check", { x: M, y: H - 54, size: 34, font: marcaBold, color: BLANCO });
  drawTracked(p1, "autoconsumo.mx", { x: M + 1, y: H - 76, size: 16, font: marcaReg, color: BLANCO, tracking: 2.4 });
  p1.drawText(nick, { x: M, y: H - headerH + 30, size: 13, font: marcaBold, color: BLANCO });
  p1.drawText(fecha, { x: M, y: H - headerH + 15, size: 9, font: marcaReg, color: BLANCO });
  drawRightAligned(p1, "Registro de autoconsumos CNE-2026", { xRight: W - M, y: H - headerH + 15, font: marcaReg, size: 9, color: BLANCO });

  const rowTop = H - headerH - 18;
  const rowH = 172;
  const rowBottom = rowTop - rowH;
  const boxGap = 14;
  const boxW = (W - 2 * M - boxGap) / 2;
  const leftBoxX = M;
  const rightBoxX = M + boxW + boxGap;

  p1.drawRectangle({ x: leftBoxX, y: rowBottom, width: boxW, height: rowH, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  p1.drawRectangle({ x: rightBoxX, y: rowBottom, width: boxW, height: rowH, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });

  const pad = 16;
  let cy = rowTop - pad - 8;
  cy = drawParagraph(p1, { text: nick, x: leftBoxX + pad, y: cy, font: fontBold, size: 12, color: NAVY, maxWidth: boxW - 2 * pad, lineHeight: 14 });
  cy -= 10;

  const filas: Array<[string, string[]]> = [
    ["Ubicación:", [payload.estado || "—"]],
    ["Almacenamiento:", [`${payload.cantidad_tanques} ${plural(payload.cantidad_tanques, "tanque", "tanques")}`]],
    ["Capacidad:", (payload.capacidad_tanques || []).map((c) => `${Number(c).toLocaleString("es-MX")} L`)],
  ];
  if (payload.combustibles?.length) {
    filas.push(["Combustible:", [payload.combustibles.join(", ")]]);
  }
  filas.push(["Antigüedad:", [`${payload.antiguedad_anios} ${plural(payload.antiguedad_anios, "año", "años")}`]]);

  for (const [label, valores] of filas) {
    p1.drawText(label, { x: leftBoxX + pad, y: cy, size: 7.5, font: fontReg, color: GRIS });
    let vy = cy;
    for (const v of valores.length ? valores : ["—"]) {
      p1.drawText(v, { x: leftBoxX + pad + 80, y: vy, size: 8.5, font: fontBold, color: NAVY });
      vy -= 11;
    }
    cy = Math.min(vy, cy - 16);
  }

  const cxScore = rightBoxX + boxW / 2;
  drawCentered(p1, "SCORE", { xCenter: cxScore, y: rowTop - pad - 8, font: fontBold, size: 10.5, color: NAVY });

  const gaugeCy = rowTop - pad - 68;
  const pct = Math.round(payload.porcentaje_puntaje);
  drawGauge(p1, { cx: cxScore, cy: gaugeCy, rInner: 34, rOuter: 48, pct, color: NARANJA, track: hex("#dfe2e8") });
  drawCentered(p1, `${pct} %`, { xCenter: cxScore, y: gaugeCy - 6, font: fontBold, size: 20, color: NARANJA_OSCURO });

  let pillColor = VERDE, pillFondo = VERDE_FONDO, pillTexto = "ESTÁS EN CONDICIONES DEL REGISTRO";
  if (!payload.elegible_registro) {
    pillColor = ROJO; pillFondo = ROJO_FONDO; pillTexto = "REGISTRO NO VIABLE POR AHORA";
  } else if (payload.tier_resultado === "critico") {
    pillColor = ROJO; pillFondo = ROJO_FONDO; pillTexto = "TIENES PUNTOS CRÍTICOS QUE ATENDER";
  } else if (payload.tier_resultado === "atencion") {
    pillColor = AMARILLO_ACENTO; pillFondo = AMARILLO_FONDO; pillTexto = "TIENES PUNTOS A REVISAR";
  }

  const pillY = gaugeCy - 30;
  const pillW = Math.min(boxW - 24, fontBold.widthOfTextAtSize(pillTexto, 7) + 38);
  const pillX = cxScore - pillW / 2;
  p1.drawRectangle({ x: pillX, y: pillY - 6, width: pillW, height: 16, color: pillFondo });
  p1.drawCircle({ x: pillX + 12, y: pillY + 2, size: 4.5, color: pillColor });
  if (pillTexto.startsWith("ESTÁS")) drawCheck(p1, { x: pillX + 9.6, y: pillY - 0.1, size: 4.8, color: BLANCO, thickness: 1 });
  p1.drawText(pillTexto, { x: pillX + 22, y: pillY - 0.5, font: fontBold, size: 7, color: pillColor });

  const rojasN = payload.alertas_rojas?.length || 0;
  const amarillasN = payload.alertas_amarillas?.length || 0;
  let countY = pillY - 22;
  if (amarillasN > 0) {
    p1.drawCircle({ x: rightBoxX + pad + 3, y: countY + 2.7, size: 2.7, color: AMARILLO_ACENTO });
    p1.drawText(`Tienes ${amarillasN} ${plural(amarillasN, "Aviso y Advertencia", "Avisos y Advertencias")}`, { x: rightBoxX + pad + 10, y: countY, size: 7.8, font: fontBold, color: NAVY });
    countY -= 12;
  }
  if (rojasN > 0) {
    p1.drawCircle({ x: rightBoxX + pad + 3, y: countY + 2.7, size: 2.7, color: ROJO });
    p1.drawText(`Tienes ${rojasN} ${plural(rojasN, "Bandera Roja - Punto Crítico", "Banderas Rojas - Puntos Críticos")}`, { x: rightBoxX + pad + 10, y: countY, size: 7.8, font: fontBold, color: NAVY });
  }

  // Cajas de alertas: si una no cabe en lo que queda de la hoja, se parte y sigue en una hoja
  // nueva (con un encabezado discreto de instalación y fecha).
  let pagina = p1;
  const paginasAlertas: PDFPage[] = [p1];
  let boxY = rowBottom - 16;
  let hojaNueva = false;
  const nuevaHoja = () => {
    pagina = doc.addPage([W, H]);
    paginasAlertas.push(pagina);
    pagina.drawText(`${nick} · Autocheck`, { x: M, y: H - 28, size: 7.5, font: fontBold, color: GRIS });
    drawRightAligned(pagina, fecha, { xRight: W - M, y: H - 28, font: fontReg, size: 7.5, color: GRIS });
    pagina.drawLine({ start: { x: M, y: H - 34 }, end: { x: W - M, y: H - 34 }, thickness: 0.5, color: CAJA_BORDE });
    boxY = H - 46;
    hojaNueva = true;
  };

  const colocarAlertas = (
    base: { titulo: string; intro: string; items: string[]; cierre: string[]; dotColor: RGB },
    estilo: { fondo: RGB; acento: RGB; icono: RGB },
  ) => {
    let pendientes = base.items;
    let primera = true;
    while (pendientes.length > 0) {
      let colocada = false;
      for (let k = pendientes.length; k >= 1; k--) {
        const box = layoutAlertBox({
          titulo: primera ? base.titulo : `${base.titulo} (continuación)`,
          intro: primera ? base.intro : "",
          items: pendientes.slice(0, k),
          cierre: k === pendientes.length ? base.cierre : [],
          fontReg, fontBold, dotColor: base.dotColor,
        });
        if (boxY - box.height >= PIE_RESERVADO || (hojaNueva && k === 1)) {
          drawAlertBox(pagina, boxY, box, { ...estilo, fontBold });
          boxY -= box.height + 12;
          hojaNueva = false;
          pendientes = pendientes.slice(k);
          primera = false;
          colocada = true;
          break;
        }
      }
      if (!colocada) nuevaHoja();
    }
  };

  if (rojasN > 0) {
    colocarAlertas({
      titulo: "PUNTOS CRÍTICOS",
      intro: `Lo que puede impedir el registro exitoso de ${nick}, o que puede tener consecuencias negativas:`,
      items: payload.alertas_rojas,
      cierre: [
        "Antes de intentar el Registro ante la CNE, debes revisar y resolver estos puntos. Existe un alto riesgo regulatorio o legal. Son asuntos prioritarios y de urgente atención.",
      ],
      dotColor: ROJO,
    }, { fondo: ROJO_FONDO, acento: ROJO, icono: ROJO });
  }

  if (amarillasN > 0) {
    colocarAlertas({
      titulo: "AVISOS Y ADVERTENCIAS",
      intro: "Lo que debes revisar antes para asegurar un registro exitoso y sin consecuencias adversas:",
      items: payload.alertas_amarillas,
      cierre: [
        "Todos estos puntos son necesarios para un registro exitoso y sin secuelas negativas. No existe un riesgo regulatorio alto, pero conviene fortalecer todos los rubros. Son asuntos relevantes para el registro y la operación regulatoria de la instalación.",
      ],
      dotColor: AMARILLO_ACENTO,
    }, { fondo: AMARILLO_FONDO, acento: AMARILLO_ACENTO, icono: AMARILLO_ACENTO });
  }

  if (rojasN === 0 && amarillasN === 0) {
    drawCentered(p1, "Sin puntos críticos ni avisos pendientes en esta revisión.", { xCenter: W / 2, y: boxY - 10, font: fontReg, size: 9, color: VERDE });
  }

  for (const p of paginasAlertas) footer(p, fontReg);

  const p2 = doc.addPage([W, H]);

  const leftW = 330;
  const rightX = M + leftW + 14;
  const rightW = W - M - rightX;
  const topY = H - 40;
  const bottomBannerH = 54;

  // Columna derecha (fija para todos): notas importantes + protocolos.
  let ry = topY;
  const barH = 22;
  p2.drawRectangle({ x: rightX, y: ry - barH, width: rightW, height: barH, color: NARANJA });
  drawCentered(p2, "NOTAS IMPORTANTES", { xCenter: rightX + rightW / 2, y: ry - barH + 7.5, font: fontBold, size: 10, color: BLANCO });
  ry -= barH + 10;

  const notaH1 = 62;
  p2.drawRectangle({ x: rightX, y: ry - notaH1, width: rightW, height: notaH1, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  drawCentered(p2, "31", { xCenter: rightX + 30, y: ry - 32, font: fontBold, size: 16, color: NARANJA });
  drawCentered(p2, "DICIEMBRE", { xCenter: rightX + 30, y: ry - 42, font: fontBold, size: 6, color: NAVY });
  const n1 = drawParagraph(p2, { text: "¿Hasta cuándo puedo registrarme?", x: rightX + 58, y: ry - 20, font: fontReg, size: T.cuerpo, color: NAVY, maxWidth: rightW - 66, lineHeight: T.lh });
  drawParagraph(p2, { text: "Hasta el 31 de diciembre de 2026.", x: rightX + 58, y: n1 - 3, font: fontBold, size: T.cuerpo, color: NAVY, maxWidth: rightW - 66, lineHeight: T.lh });
  ry -= notaH1 + 10;

  const notaH2 = 72;
  p2.drawRectangle({ x: rightX, y: ry - notaH2, width: rightW, height: notaH2, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  // Logo del SAT: cuatro esferas juntas.
  for (const [dx, dy] of [[-5, 5], [5, 5], [-5, -5], [5, -5]]) {
    p2.drawCircle({ x: rightX + 30 + dx, y: ry - 28 + dy, size: 5, color: NARANJA });
  }
  drawCentered(p2, "SAT", { xCenter: rightX + 30, y: ry - 52, font: fontBold, size: 9.5, color: NARANJA });
  const n2 = drawParagraph(p2, { text: "Si en un solo mes superas los 75,714 litros de consumo:", x: rightX + 58, y: ry - 18, font: fontReg, size: T.cuerpo, color: NAVY, maxWidth: rightW - 66, lineHeight: T.lh });
  drawParagraph(p2, { text: "debes instalar controles volumétricos.", x: rightX + 58, y: n2 - 3, font: fontBold, size: T.cuerpo, color: NAVY, maxWidth: rightW - 66, lineHeight: T.lh });
  ry -= notaH2 + 10;

  p2.drawRectangle({ x: rightX, y: ry - barH, width: rightW, height: barH, color: NARANJA });
  drawCentered(p2, "¿YA TIENES PROTOCOLOS?", { xCenter: rightX + rightW / 2, y: ry - barH + 7.5, font: fontBold, size: 9, color: BLANCO });
  ry -= barH;
  const protocolos = ["Protocolo de atención a visitas e inspecciones", "Protocolo de debida compra y recepción de combustibles"];
  const protTop = ry;
  let py = ry - 18;
  const protRows: Array<[number, string[]]> = [];
  for (const prot of protocolos) {
    const lineas = wrapText(fontBold, prot, T.cuerpo, rightW - 46);
    protRows.push([py, lineas]);
    py -= lineas.length * T.lh + 8;
  }
  const protH = protTop - py + 20;
  p2.drawRectangle({ x: rightX, y: protTop - protH, width: rightW, height: protH, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  for (const [y0, lineas] of protRows) {
    drawStar(p2, { cx: rightX + 20, cy: y0 + 3, r: 5.5, color: NARANJA });
    let ly0 = y0;
    for (const l of lineas) {
      p2.drawText(l, { x: rightX + 34, y: ly0, size: T.cuerpo, font: fontBold, color: NAVY });
      ly0 -= T.lh;
    }
  }
  p2.drawRectangle({ x: rightX, y: protTop - protH, width: rightW, height: 18, color: NAVY });
  drawCentered(p2, "www.autoconsumo.mx", { xCenter: rightX + rightW / 2, y: protTop - protH + 6, font: fontBold, size: 7.5, color: BLANCO });
  const rightBottom = protTop - protH;

  // Columna izquierda (personalizada): fortalezas. Mide lo mismo que la derecha, o más si no cabe.
  const fortalezas = payload.fortalezas?.length ? payload.fortalezas : ["Sigue completando tu autocheck para ver aquí tus puntos adecuados."];
  const filasF = fortalezas.map((f) => wrapText(fontReg, f, T.cuerpo, leftW - 56));
  const contenidoF = 54 + filasF.reduce((acc, ls) => acc + ls.length * T.lh + 6, 0) + 8;
  const leftBottom = Math.min(rightBottom, topY - contenidoF);
  p2.drawRectangle({ x: M, y: leftBottom, width: leftW, height: topY - leftBottom, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  let ly = topY - 28;
  p2.drawCircle({ x: M + 24, y: ly + 3, size: 9.5, color: VERDE });
  drawCheck(p2, { x: M + 19.5, y: ly - 1, size: 8, color: BLANCO, thickness: 1.5 });
  p2.drawText(nick, { x: M + 40, y: ly + 7, size: 10.5, font: fontBold, color: NAVY });
  p2.drawText("PUNTOS ADECUADOS", { x: M + 40, y: ly - 6, size: 12, font: fontBold, color: NAVY });
  ly -= 26;
  for (const lineas of filasF) {
    p2.drawCircle({ x: M + 24, y: ly + 2.6, size: 2.2, color: VERDE });
    for (const l of lineas) {
      p2.drawText(l, { x: M + 40, y: ly, size: T.cuerpo, font: fontReg, color: NAVY });
      ly -= T.lh;
    }
    ly -= 6;
  }

  // Banner de marca + noticia de uso, anclados al pie de la hoja.
  const legalTexto =
    "Autocheck es una plataforma digital en servicio para los miembros registrados en autoconsumo.mx. Está diseñada a partir del ACUERDO de la Comisión Nacional de Energía por el que se establece el Programa de Registro de Personas que Cuentan con Instalaciones en las que se realiza la actividad de despacho para autoconsumo de petrolíferos, publicado en el Diario Oficial de la Federación el 11 de agosto de 2026. El trámite del registro es gratuito y se realiza de forma digital por internet. La plataforma de autocheck de autoconsumo.mx no tiene relación oficial con la CNE ni con su portal, ni constituye una validación formal de ninguna clase. Este reporte de autocheck es resultado de la información proporcionada por el usuario. No significa ni representa una asesoría legal bajo ninguna circunstancia. Su utilidad es de autorevisión previa e independiente al registro oficial de la CNE.";
  const legalLineas = wrapText(fontReg, legalTexto, 7, W - 2 * M);
  const legalAlto = 14 + legalLineas.length * 8.6;
  const bannerY = PIE_RESERVADO + legalAlto + 12;

  p2.drawRectangle({ x: M, y: bannerY, width: W - 2 * M, height: bottomBannerH, color: NARANJA });
  const mitadIzq = M + (W / 2 - M) / 2;
  const mitadDer = W / 2 + (W / 2 - M) / 2;
  drawCentered(p2, "autoconsumo.mx", { xCenter: mitadIzq, y: bannerY + bottomBannerH / 2 - 6, font: marcaBold, size: 18, color: BLANCO });
  p2.drawLine({ start: { x: W / 2, y: bannerY + 12 }, end: { x: W / 2, y: bannerY + bottomBannerH - 12 }, thickness: 1, color: BLANCO });
  drawCentered(p2, "Consultoría Especializada", { xCenter: mitadDer, y: bannerY + bottomBannerH / 2 + 4, font: marcaReg, size: 10, color: BLANCO });
  drawCentered(p2, "Instalaciones llave en mano", { xCenter: mitadDer, y: bannerY + bottomBannerH / 2 - 11, font: marcaReg, size: 10, color: BLANCO });

  const legalY = bannerY - 16;
  p2.drawText("Noticia de uso", { x: M, y: legalY, size: 9.5, font: fontBold, color: NAVY });
  let lgy = legalY - 13;
  for (const l of legalLineas) {
    p2.drawText(l, { x: M, y: lgy, size: 7, font: fontReg, color: GRIS });
    lgy -= 8.6;
  }

  footer(p2, fontReg);

  return await doc.save();
}

function pdfABase64(pdfBytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < pdfBytes.length; i += chunk) {
    binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function enviarCorreo(payload: Payload, base64Pdf: string, resendKey: string) {
  const primerNombre = (payload.nombre_contacto || "").trim().split(/\s+/)[0] || "";
  const nick = payload.nombre_instalacion || payload.empresa || "tu instalación";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [payload.correo],
      subject: `Tu reporte Autocheck — ${nick}`,
      html: `<p>Hola${primerNombre ? " " + primerNombre : ""},</p><p>Adjunto está el reporte de tu Autocheck de <strong>autoconsumo.mx</strong> para <strong>${nick}</strong>.</p><p>Este reporte es de autorevisión previa e independiente al registro oficial ante la CNE.</p><p>— autoconsumo.mx</p>`,
      attachments: [{ filename: "autocheck.pdf", content: base64Pdf }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Copia interna para Alfredo: le avisa cada vez que alguien genera un autocheck, con cuántos
// lleva de su límite (gratis + cupo extra) y, si se sabe, de qué red llegó (utm_source).
async function enviarCopiaInterna(
  payload: Payload,
  base64Pdf: string,
  resendKey: string,
  info: { usados: number; limite: number; origen: string | null },
) {
  const nombre = escaparHtml(payload.nombre_contacto || "(sin nombre)");
  const empresa = escaparHtml(payload.empresa || "(sin empresa)");
  const instalacion = escaparHtml(payload.nombre_instalacion || "(sin nombre de instalación)");
  const estado = escaparHtml(payload.estado || "(sin estado)");
  const origenTexto = info.origen ? (ORIGEN_LABEL[info.origen.toLowerCase()] || escaparHtml(info.origen)) : null;

  const html = `
<p><strong>${nombre}</strong>, de la empresa <strong>${empresa}</strong>, con la instalación <strong>${instalacion}</strong>, de <strong>${estado}</strong>, ha generado un autocheck (${info.usados}/${info.limite}).</p>
${origenTexto ? `<p>Llegó desde: <strong>${origenTexto}</strong></p>` : ""}
<p>Aquí está la copia.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [CORREO_INTERNO],
      subject: `Autocheck generado (${info.usados}/${info.limite}) — ${payload.empresa || payload.nombre_contacto || "sin nombre"}`,
      html,
      attachments: [{ filename: "autocheck.pdf", content: base64Pdf }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend (copia interna) respondió ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const payload = (await req.json()) as Payload;
    if (!payload.correo) {
      return new Response(JSON.stringify({ ok: false, error: "Falta correo" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const pdfBytes = await buildAutocheckPdf(payload, await cargarPoppins());

    if (payload.preview) {
      return new Response(pdfBytes, { headers: { "Content-Type": "application/pdf", ...CORS_HEADERS } });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: resendKey, error: keyErr } = await supabaseAdmin.rpc("obtener_resend_api_key");
    if (keyErr || !resendKey) {
      throw new Error("No se pudo obtener la API key de Resend: " + (keyErr?.message || "no configurada"));
    }

    const base64Pdf = pdfABase64(pdfBytes);
    const emailResult = await enviarCorreo(payload, base64Pdf, resendKey as string);

    // Copia interna para Alfredo (cuántos autochecks lleva + de qué red llegó). No debe tumbar
    // la respuesta al usuario si falla: éste ya tiene su reporte en camino.
    try {
      const correoNorm = payload.correo.trim().toLowerCase();
      const [{ data: filas, count }, { data: membresia }] = await Promise.all([
        supabaseAdmin
          .from("leads_autocheck_estaciones")
          .select("utm_source", { count: "exact" })
          .ilike("correo", correoNorm)
          .order("created_at", { ascending: false })
          .limit(1),
        supabaseAdmin.from("autocheck_membresias").select("cupo_extra").eq("correo", correoNorm).maybeSingle(),
      ]);
      const usados = count ?? 1;
      const limite = LIMITE_AUTOCHECKS_GRATIS + (membresia?.cupo_extra ?? 0);
      const origen = filas?.[0]?.utm_source ?? null;
      await enviarCopiaInterna(payload, base64Pdf, resendKey as string, { usados, limite, origen });
    } catch (e) {
      console.error("No se pudo enviar la copia interna:", e);
    }

    return new Response(JSON.stringify({ ok: true, email: emailResult }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
