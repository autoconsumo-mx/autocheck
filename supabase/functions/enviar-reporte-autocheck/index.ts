// Supabase Edge Function: enviar-reporte-autocheck
// Genera el PDF de 2 páginas del Autocheck (igual al mockup de Alfredo) y lo envía
// por correo con Resend. Se invoca desde el cliente justo después de insertar el
// registro en leads_autocheck_estaciones (ver index (2).html).
//
// Requiere que exista, en la base de datos, el secreto 'resend_api_key' en Vault
// y la función public.obtener_resend_api_key() (SECURITY DEFINER, solo service_role).

import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage, RGB } from "npm:pdf-lib@1.17.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_FROM_EMAIL = "autocheck@autoconsumo.mx";
const RESEND_FROM_NAME = "Autocheck · autoconsumo.mx";

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

// Icono esquemático de escudo (solo primitivas: círculo, rectángulo, líneas).
function drawShieldIcon(page: PDFPage, opts: { cx: number; cy: number; size: number; color: RGB }) {
  const { cx, cy, size, color } = opts;
  const w = size;
  const h = size * 1.25;
  const top = cy + h / 2;
  const bottom = cy - h / 2;
  const neckY = top - w * 0.5;
  const bodyBottom = bottom + h * 0.3;
  page.drawCircle({ x: cx, y: neckY, size: w / 2, color });
  page.drawRectangle({ x: cx - w / 2, y: bodyBottom, width: w, height: neckY - bodyBottom, color });
  page.drawLine({ start: { x: cx - w / 2, y: bodyBottom }, end: { x: cx, y: bottom }, thickness: w * 0.5, color });
  page.drawLine({ start: { x: cx + w / 2, y: bodyBottom }, end: { x: cx, y: bottom }, thickness: w * 0.5, color });
  page.drawRectangle({ x: cx - w * 0.3, y: cy - 1, width: w * 0.6, height: 2, color: BLANCO });
}

// Icono esquemático de pipa/camión cisterna (solo primitivas: círculo, rectángulo).
function drawPipaIcon(page: PDFPage, opts: { cx: number; cy: number; size: number; color: RGB }) {
  const { cx, cy, size, color } = opts;
  const h = size;
  const tankLen = size * 1.6;
  const tankLeft = cx - tankLen / 2;
  const tankRight = cx + tankLen / 2;
  const cabW = h * 0.8;
  page.drawRectangle({ x: tankLeft, y: cy - h / 2, width: tankLen, height: h, color });
  page.drawCircle({ x: tankLeft, y: cy, size: h / 2, color });
  page.drawCircle({ x: tankRight, y: cy, size: h / 2, color });
  page.drawRectangle({ x: tankLeft - cabW, y: cy - h * 0.35, width: cabW, height: h * 0.7, color });
  const wheelR = h * 0.2;
  page.drawCircle({ x: tankLeft - cabW * 0.3, y: cy - h / 2, size: wheelR, color: NAVY });
  page.drawCircle({ x: tankLeft + tankLen * 0.35, y: cy - h / 2, size: wheelR, color: NAVY });
  page.drawCircle({ x: tankRight - tankLen * 0.1, y: cy - h / 2, size: wheelR, color: NAVY });
}

function footer(page: PDFPage, font: PDFFont) {
  drawCentered(page, "POWERED BY REGNAUTILUS©", { xCenter: W / 2, y: 22, font, size: 8.5, color: GRIS_CLARO });
  drawCentered(page, "www.autoconsumo.mx", { xCenter: W / 2, y: 12, font, size: 8.5, color: GRIS_CLARO });
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

function fechaHoy(): string {
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}-${meses[d.getMonth()]}-${d.getFullYear()}`;
}

async function buildAutocheckPdf(payload: Payload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const nick = payload.nombre_instalacion || payload.empresa || "tu instalación";
  const fecha = payload.fecha || fechaHoy();

  const p1 = doc.addPage([W, H]);

  const headerH = 150;
  p1.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: NARANJA });

  p1.drawText("Auto-check", { x: M, y: H - 68, size: 38, font: fontBold, color: BLANCO });
  p1.drawText("a u t o c o n s u m o . m x", { x: M, y: H - 95, size: 15, font: fontReg, color: BLANCO });
  p1.drawText(nick, { x: M, y: H - headerH + 34, size: 16, font: fontBold, color: BLANCO });
  p1.drawText(fecha, { x: M, y: H - headerH + 16, size: 10.5, font: fontReg, color: BLANCO });
  drawRightAligned(p1, "Registro de autoconsumos CNE-2026", { xRight: W - M, y: H - headerH + 16, font: fontReg, size: 10, color: BLANCO });

  const rowTop = H - headerH - 20;
  const rowH = 210;
  const rowBottom = rowTop - rowH;
  const boxGap = 16;
  const boxW = (W - 2 * M - boxGap) / 2;
  const leftBoxX = M;
  const rightBoxX = M + boxW + boxGap;

  p1.drawRectangle({ x: leftBoxX, y: rowBottom, width: boxW, height: rowH, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  p1.drawRectangle({ x: rightBoxX, y: rowBottom, width: boxW, height: rowH, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });

  const pad = 18;
  let cy = rowTop - pad - 6;
  p1.drawText(nick.toUpperCase(), { x: leftBoxX + pad, y: cy, size: 16, font: fontBold, color: NAVY });
  cy -= 26;

  const filas: Array<[string, string[]]> = [
    ["Ubicación:", [payload.estado || "—"]],
    ["Almacenamiento:", [`${payload.cantidad_tanques} tanque(s)`]],
    ["Capacidad:", (payload.capacidad_tanques || []).map((c) => `${Number(c).toLocaleString("es-MX")} L`)],
  ];
  if (payload.combustibles?.length) {
    filas.push(["Combustible:", [payload.combustibles.join(", ")]]);
  }
  filas.push(["Antigüedad:", [`${payload.antiguedad_anios} año(s)`]]);

  for (const [label, valores] of filas) {
    p1.drawText(label, { x: leftBoxX + pad, y: cy, size: 8.5, font: fontReg, color: GRIS });
    let vy = cy;
    for (const v of valores.length ? valores : ["—"]) {
      p1.drawText(v, { x: leftBoxX + pad + 92, y: vy, size: 9.5, font: fontBold, color: NAVY });
      vy -= 14;
    }
    cy = Math.min(vy, cy - 20);
  }

  const cxScore = rightBoxX + boxW / 2;
  drawCentered(p1, "SCORE", { xCenter: cxScore, y: rowTop - pad - 6, font: fontBold, size: 13, color: NAVY });

  const gaugeCy = rowTop - pad - 78;
  const rInner = 40;
  const rOuter = 56;
  const pct = Math.round(payload.porcentaje_puntaje);
  drawGauge(p1, { cx: cxScore, cy: gaugeCy, rInner, rOuter, pct, color: NARANJA, track: hex("#dfe2e8") });
  drawCentered(p1, `${pct} %`, { xCenter: cxScore, y: gaugeCy - 10, font: fontBold, size: 24, color: NARANJA_OSCURO });

  let pillColor = VERDE, pillFondo = VERDE_FONDO, pillTexto = "ESTÁS EN CONDICIONES DEL REGISTRO";
  if (!payload.elegible_registro) {
    pillColor = ROJO; pillFondo = ROJO_FONDO; pillTexto = "REGISTRO NO VIABLE POR AHORA";
  } else if (payload.tier_resultado === "critico") {
    pillColor = ROJO; pillFondo = ROJO_FONDO; pillTexto = "TIENES PUNTOS CRÍTICOS QUE ATENDER";
  } else if (payload.tier_resultado === "atencion") {
    pillColor = AMARILLO_ACENTO; pillFondo = AMARILLO_FONDO; pillTexto = "TIENES PUNTOS A REVISAR";
  }

  const pillY = gaugeCy - 40;
  const pillPadX = 10;
  const pillTextW = fontBold.widthOfTextAtSize(pillTexto, 8);
  const pillW = Math.min(boxW - 24, pillTextW + pillPadX * 2 + 16);
  const pillX = cxScore - pillW / 2;
  p1.drawRectangle({ x: pillX, y: pillY - 7, width: pillW, height: 18, color: pillFondo });
  p1.drawCircle({ x: pillX + 13, y: pillY + 2, size: 5, color: pillColor });
  if (pillTexto.startsWith("ESTÁS")) drawCheck(p1, { x: pillX + 10.3, y: pillY - 0.3, size: 5.4, color: BLANCO, thickness: 1.1 });
  drawParagraph(p1, { text: pillTexto, x: pillX + 22, y: pillY - 2, font: fontBold, size: 7.6, color: pillColor, maxWidth: pillW - 26, lineHeight: 9 });

  const rojasN = payload.alertas_rojas?.length || 0;
  const amarillasN = payload.alertas_amarillas?.length || 0;
  let countY = pillY - 26;
  if (amarillasN > 0) {
    p1.drawCircle({ x: rightBoxX + pad + 3, y: countY + 3, size: 3, color: AMARILLO });
    p1.drawText(`Tienes ${amarillasN} Avisos y Advertencias`, { x: rightBoxX + pad + 10, y: countY, size: 8.5, font: fontBold, color: NAVY });
    countY -= 14;
  }
  if (rojasN > 0) {
    p1.drawCircle({ x: rightBoxX + pad + 3, y: countY + 3, size: 3, color: ROJO });
    p1.drawText(`Tienes ${rojasN} Bandera(s) Roja(s) - Puntos Críticos`, { x: rightBoxX + pad + 10, y: countY, size: 8.5, font: fontBold, color: NAVY });
  }

  let boxY = rowBottom - 22;

  if (rojasN > 0) {
    const introLines = wrapText(fontBold, `Lo que puede impedir el registro exitoso de ${nick}, o que puede tener consecuencias negativas:`, 9.5, W - 2 * M - 2 * pad);
    const itemLines = payload.alertas_rojas.reduce((acc, it) => acc + wrapText(fontReg, it, 9.5, W - 2 * M - 2 * pad - 12).length, 0);
    const closing = 3;
    const boxH = 44 + introLines.length * 12 + itemLines * 13 + closing * 12 + 14;
    p1.drawRectangle({ x: M, y: boxY - boxH, width: W - 2 * M, height: boxH, color: ROJO_FONDO });
    p1.drawRectangle({ x: M, y: boxY - boxH, width: 4, height: boxH, color: ROJO });
    p1.drawCircle({ x: M + pad + 6, y: boxY - 16, size: 8, color: ROJO });
    p1.drawText("!", { x: M + pad + 6 - 1.6, y: boxY - 19.5, size: 10, font: fontBold, color: BLANCO });
    p1.drawText("PUNTOS CRÍTICOS", { x: M + pad + 22, y: boxY - 20, size: 13, font: fontBold, color: NAVY });
    let iy = boxY - 40;
    iy = drawParagraph(p1, { text: `Lo que puede impedir el registro exitoso de ${nick}, o que puede tener consecuencias negativas:`, x: M + pad, y: iy, font: fontBold, size: 9.5, color: NAVY, maxWidth: W - 2 * M - 2 * pad, lineHeight: 12 });
    iy -= 4;
    iy = drawBulletList(p1, { items: payload.alertas_rojas, x: M + pad, y: iy, font: fontReg, size: 9.5, color: NAVY, maxWidth: W - 2 * M - 2 * pad, lineHeight: 13, gap: 3, dotColor: ROJO });
    iy -= 6;
    for (const linea of [
      "Antes de intentar el Registro ante la CNE, debes revisar y resolver estos puntos.",
      "Existe un alto riesgo regulatorio o legal.",
      "Son asuntos prioritarios y de urgente atención.",
    ]) {
      p1.drawText(linea, { x: M + pad, y: iy, size: 9.3, font: fontBold, color: NAVY });
      iy -= 12.5;
    }
    boxY -= boxH + 16;
  }

  if (amarillasN > 0) {
    const itemLines = payload.alertas_amarillas.reduce((acc, it) => acc + wrapText(fontReg, it, 9.5, W - 2 * M - 2 * pad - 12).length, 0);
    const boxH = 44 + 12 + itemLines * 13 + 3 * 12 + 14;
    p1.drawRectangle({ x: M, y: boxY - boxH, width: W - 2 * M, height: boxH, color: AMARILLO_FONDO });
    p1.drawRectangle({ x: M, y: boxY - boxH, width: 4, height: boxH, color: AMARILLO_ACENTO });
    p1.drawCircle({ x: M + pad + 6, y: boxY - 16, size: 8, color: AMARILLO });
    p1.drawText("!", { x: M + pad + 6 - 1.6, y: boxY - 19.5, size: 10, font: fontBold, color: BLANCO });
    p1.drawText("AVISOS Y ADVERTENCIAS", { x: M + pad + 22, y: boxY - 20, size: 13, font: fontBold, color: NAVY });
    let iy = boxY - 40;
    iy = drawParagraph(p1, { text: "Lo que debes revisar antes para asegurar un registro exitoso y sin consecuencias adversas:", x: M + pad, y: iy, font: fontBold, size: 9.5, color: NAVY, maxWidth: W - 2 * M - 2 * pad, lineHeight: 12 });
    iy -= 4;
    iy = drawBulletList(p1, { items: payload.alertas_amarillas, x: M + pad, y: iy, font: fontReg, size: 9.5, color: NAVY, maxWidth: W - 2 * M - 2 * pad, lineHeight: 13, gap: 3, dotColor: AMARILLO });
    iy -= 6;
    for (const linea of [
      "Todos estos puntos son necesarios para un registro exitoso y sin secuelas negativas.",
      "No existe un riesgo regulatorio alto, pero conviene fortalecer todos los rubros.",
      "Son asuntos relevantes para el registro y la operación regulatoria de la instalación.",
    ]) {
      p1.drawText(linea, { x: M + pad, y: iy, size: 9.3, font: fontBold, color: NAVY });
      iy -= 12.5;
    }
    boxY -= boxH + 16;
  }

  if (rojasN === 0 && amarillasN === 0) {
    drawCentered(p1, "Sin puntos críticos ni avisos pendientes en esta revisión.", { xCenter: W / 2, y: boxY - 10, font: fontReg, size: 10.5, color: VERDE });
  }

  footer(p1, fontReg);

  const p2 = doc.addPage([W, H]);

  const leftW = 330;
  const rightX = M + leftW + 16;
  const rightW = W - M - rightX;
  const topY = H - 40;
  const bottomBannerH = 60;
  const legalBoxTop = 195;

  const leftBoxBottom = legalBoxTop;
  p2.drawRectangle({ x: M, y: leftBoxBottom, width: leftW, height: topY - leftBoxBottom, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  let ly = topY - 34;
  p2.drawCircle({ x: M + 26, y: ly + 4, size: 11, color: VERDE });
  drawCheck(p2, { x: M + 21, y: ly - 1, size: 9, color: BLANCO, thickness: 1.6 });
  p2.drawText(nick, { x: M + 44, y: ly + 9, size: 13, font: fontBold, color: NAVY });
  p2.drawText("PUNTOS ADECUADOS", { x: M + 44, y: ly - 8, size: 15, font: fontBold, color: NAVY });
  ly -= 44;
  const fortalezas = payload.fortalezas?.length ? payload.fortalezas : ["Sigue completando tu autocheck para ver aquí tus puntos adecuados."];
  for (const f of fortalezas) {
    p2.drawCircle({ x: M + 24, y: ly + 4, size: 3, color: VERDE });
    ly = drawParagraph(p2, { text: f, x: M + 44, y: ly + 4, font: fontReg, size: 9.3, color: NAVY, maxWidth: leftW - 60, lineHeight: 14 });
    ly -= 10;
  }

  let ry = topY;
  const barH = 26;
  p2.drawRectangle({ x: rightX, y: ry - barH, width: rightW, height: barH, color: NARANJA });
  drawCentered(p2, "NOTAS IMPORTANTES", { xCenter: rightX + rightW / 2, y: ry - barH + 9, font: fontBold, size: 12, color: BLANCO });
  ry -= barH + 12;

  const notaH1 = 78;
  p2.drawRectangle({ x: rightX, y: ry - notaH1, width: rightW, height: notaH1, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  drawCentered(p2, "31", { xCenter: rightX + 34, y: ry - 40, font: fontBold, size: 18, color: NARANJA });
  drawCentered(p2, "DICIEMBRE", { xCenter: rightX + 34, y: ry - 52, font: fontBold, size: 7, color: NAVY });
  drawParagraph(p2, { text: "¿Hasta cuándo puedo registrarme?", x: rightX + 66, y: ry - 22, font: fontReg, size: 8.5, color: NAVY, maxWidth: rightW - 76, lineHeight: 10.5 });
  drawParagraph(p2, { text: "Hasta el 31 de diciembre de 2026.", x: rightX + 66, y: ry - 56, font: fontBold, size: 8.3, color: NAVY, maxWidth: rightW - 76, lineHeight: 10.5 });
  ry -= notaH1 + 12;

  const notaH2 = 78;
  p2.drawRectangle({ x: rightX, y: ry - notaH2, width: rightW, height: notaH2, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  drawCentered(p2, "SAT", { xCenter: rightX + 34, y: ry - 50, font: fontBold, size: 11, color: NARANJA });
  p2.drawCircle({ x: rightX + 25, y: ry - 22, size: 5, color: NARANJA });
  p2.drawCircle({ x: rightX + 43, y: ry - 22, size: 5, color: NARANJA });
  p2.drawCircle({ x: rightX + 25, y: ry - 35, size: 5, color: NARANJA });
  p2.drawCircle({ x: rightX + 43, y: ry - 35, size: 5, color: NARANJA });
  drawParagraph(p2, { text: "Si en un solo mes superas los 75,714 litros de consumo:", x: rightX + 72, y: ry - 22, font: fontReg, size: 8.3, color: NAVY, maxWidth: rightW - 82, lineHeight: 10.5 });
  drawParagraph(p2, { text: "debes instalar controles volumétricos.", x: rightX + 72, y: ry - 52, font: fontBold, size: 8.3, color: NAVY, maxWidth: rightW - 82, lineHeight: 10.5 });
  ry -= notaH2 + 12;

  p2.drawRectangle({ x: rightX, y: ry - barH, width: rightW, height: barH, color: NARANJA });
  drawCentered(p2, "¿YA TIENES PROTOCOLOS?", { xCenter: rightX + rightW / 2, y: ry - barH + 9, font: fontBold, size: 9.5, color: BLANCO });
  ry -= barH;
  const protH = 92;
  p2.drawRectangle({ x: rightX, y: ry - protH, width: rightW, height: protH, color: CAJA_FONDO, borderColor: CAJA_BORDE, borderWidth: 1 });
  drawShieldIcon(p2, { cx: rightX + 30, cy: ry - 17, size: 13, color: NARANJA });
  drawParagraph(p2, { text: "Protocolo de atención a visitas e inspecciones", x: rightX + 52, y: ry - 20, font: fontBold, size: 8.5, color: NAVY, maxWidth: rightW - 66, lineHeight: 10.5 });
  drawPipaIcon(p2, { cx: rightX + 30, cy: ry - 49, size: 11, color: NARANJA });
  drawParagraph(p2, { text: "Protocolo de debida compra y recepción de combustibles", x: rightX + 52, y: ry - 52, font: fontBold, size: 8.5, color: NAVY, maxWidth: rightW - 66, lineHeight: 10.5 });
  p2.drawRectangle({ x: rightX, y: ry - protH, width: rightW, height: 20, color: NAVY });
  drawCentered(p2, "www.autoconsumo.mx", { xCenter: rightX + rightW / 2, y: ry - protH + 6.5, font: fontBold, size: 8.3, color: BLANCO });

  const bannerY = legalBoxTop - 16 - bottomBannerH;
  p2.drawRectangle({ x: M, y: bannerY, width: W - 2 * M, height: bottomBannerH, color: NARANJA });
  p2.drawText("autoconsumo.mx", { x: M + 20, y: bannerY + bottomBannerH / 2 - 6, size: 20, font: fontBold, color: BLANCO });
  drawRightAligned(p2, "Consultoría Especializada", { xRight: W - M - 16, y: bannerY + bottomBannerH / 2 + 6, font: fontReg, size: 11, color: BLANCO });
  drawRightAligned(p2, "Instalaciones llave en mano", { xRight: W - M - 16, y: bannerY + bottomBannerH / 2 - 12, font: fontReg, size: 11, color: BLANCO });

  const legalY = bannerY - 14;
  p2.drawText("Noticia de uso", { x: M, y: legalY, size: 11.5, font: fontBold, color: NAVY });
  const legalTexto =
    "Autocheck es una plataforma digital en servicio para los miembros registrados en autoconsumo.mx. Está diseñada a partir del ACUERDO de la Comisión Nacional de Energía por el que se establece el Programa de Registro de Personas que Cuentan con Instalaciones en las que se realiza la actividad de despacho para autoconsumo de petrolíferos, publicado en el Diario Oficial de la Federación el 11 de agosto de 2026. El trámite del registro es gratuito y se realiza de forma digital por internet. La plataforma de autocheck de autoconsumo.mx no tiene relación oficial con la CNE ni con su portal, ni constituye una validación formal de ninguna clase. Este reporte de autocheck es resultado de la información proporcionada por el usuario. No significa ni representa una asesoría legal bajo ninguna circunstancia. Su utilidad es de autorevisión previa e independiente al registro oficial de la CNE.";
  drawParagraph(p2, { text: legalTexto, x: M, y: legalY - 16, font: fontReg, size: 7.6, color: GRIS, maxWidth: W - 2 * M, lineHeight: 9.3 });

  footer(p2, fontReg);

  return await doc.save();
}

async function enviarCorreo(payload: Payload, pdfBytes: Uint8Array, resendKey: string) {
  const primerNombre = (payload.nombre_contacto || "").trim().split(/\s+/)[0] || "";
  const nick = payload.nombre_instalacion || payload.empresa || "tu instalación";
  let base64Pdf = "";
  {
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < pdfBytes.length; i += chunk) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
    }
    base64Pdf = btoa(binary);
  }

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const payload = (await req.json()) as Payload;
    if (!payload.correo) {
      return new Response(JSON.stringify({ ok: false, error: "Falta correo" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const pdfBytes = await buildAutocheckPdf(payload);

    if (payload.preview) {
      return new Response(pdfBytes, { headers: { "Content-Type": "application/pdf", ...CORS_HEADERS } });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: resendKey, error: keyErr } = await supabaseAdmin.rpc("obtener_resend_api_key");
    if (keyErr || !resendKey) {
      throw new Error("No se pudo obtener la API key de Resend: " + (keyErr?.message || "no configurada"));
    }

    const emailResult = await enviarCorreo(payload, pdfBytes, resendKey as string);
    return new Response(JSON.stringify({ ok: true, email: emailResult }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
