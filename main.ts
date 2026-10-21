/**
 * CO2-Anzeige: Calliope mini 3 + CO2-Sensor SCD40 + Farb-OLED SSD1331 (96x64)
 *
 * Oben ein Bogen von 400 bis 2000 ppm (grün → gelb → rot → lila),
 * in der Mitte der CO2-Wert, unten Temperatur und Luftfeuchtigkeit.
 */

const PPM_MIN = 400
const PPM_MAX = 2000

const TEXT = ssd1331.rgb(0x30A8FF)   // hellblau wie bei einer LCD-Anzeige

// Bogen: Mittelpunkt, Radien und Öffnung unten (270° Bogen)
const CX = 47.5
const CY = 29.5
const R_IN = 24
const R_OUT = 29.5
const EDGE = 1.2      // Breite der Umrandung des leeren Bogenteils
const ARC_START = 225 // unten links (Grad, mathematisch)
const ARC_SPAN = 270

// Farbverlauf entlang des Bogens: [ppm, Farbe]
const STOPS = [
    [400, 0x00D84A],
    [800, 0x40E040],
    [1000, 0xD8E000],
    [1400, 0xFF5010],
    [2000, 0xA040FF]
]

// Pixel des Bogens, einmal beim Start berechnet
let ringIdx: number[] = []   // Pixelnummer im Bildpuffer
let ringPos: number[] = []   // Position entlang des Bogens 0..255
let ringEdge: number[] = []  // 1 = Rand
let bright: number[] = []    // Farbe für Position 0..255 (gefüllt)
let dim: number[] = []       // Farbe für Position 0..255 (leer, Rand)

function mix(a: number, b: number, f: number): number {
    let c = 0
    for (let shift = 0; shift <= 16; shift += 8) {
        const ca = (a >> shift) & 0xFF
        const cb = (b >> shift) & 0xFF
        c |= Math.round(ca + (cb - ca) * f) << shift
    }
    return c
}

function colorAt(ppm: number): number {
    for (let i = 1; i < STOPS.length; i++) {
        if (ppm <= STOPS[i][0]) {
            const f = (ppm - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0])
            return mix(STOPS[i - 1][1], STOPS[i][1], Math.max(0, f))
        }
    }
    return STOPS[STOPS.length - 1][1]
}

function setupArc(): void {
    for (let p = 0; p < 256; p++) {
        const c = colorAt(PPM_MIN + (PPM_MAX - PPM_MIN) * p / 255)
        bright.push(ssd1331.rgb(c))
        dim.push(ssd1331.rgb(mix(0x000000, c, 0.45)))
    }
    for (let y = 0; y < ssd1331.HEIGHT; y++) {
        for (let x = 0; x < ssd1331.WIDTH; x++) {
            const dx = x - CX
            const dy = y - CY
            const r = Math.sqrt(dx * dx + dy * dy)
            if (r < R_IN || r > R_OUT) continue
            const a = Math.atan2(-dy, dx) * 180 / Math.PI
            let p = ARC_START - a
            if (p < 0) p += 360
            if (p >= 360) p -= 360
            if (p > ARC_SPAN) continue
            ringIdx.push(y * ssd1331.WIDTH + x)
            ringPos.push(Math.round(p / ARC_SPAN * 255))
            ringEdge.push(r < R_IN + EDGE || r > R_OUT - EDGE ? 1 : 0)
        }
    }
}

function drawArc(ppm: number): void {
    const level = Math.round(Math.constrain((ppm - PPM_MIN) / (PPM_MAX - PPM_MIN), 0, 1) * 255)
    for (let i = 0; i < ringIdx.length; i++) {
        const p = ringPos[i]
        let c = 0
        if (ppm > 0 && p <= level) c = bright[p]
        else if (ringEdge[i]) c = dim[p]
        else continue
        const b = Math.idiv(ringIdx[i], ssd1331.BAND_PIXELS)
        const band = ssd1331.bands[b]
        const j = (ringIdx[i] - b * ssd1331.BAND_PIXELS) * 2
        band[j] = c >> 8
        band[j + 1] = c & 0xFF
    }
}

// --- Siebensegment-Ziffern ---------------------------------------------
// Bits: a=1 oben, b=2 oben rechts, c=4 unten rechts, d=8 unten,
//       e=16 unten links, f=32 oben links, g=64 Mitte
const SEGMENTS = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F]
const MINUS = 0x40

function drawSegments(mask: number, x: number, y: number, w: number, h: number, t: number, c: number): void {
    const mid = y + ((h - t) >> 1)
    const upper = mid - y - t
    const lower = y + h - t - (mid + t)
    if (mask & 1) ssd1331.fillRect(x + t, y, w - 2 * t, t, c)
    if (mask & 2) ssd1331.fillRect(x + w - t, y + t, t, upper, c)
    if (mask & 4) ssd1331.fillRect(x + w - t, mid + t, t, lower, c)
    if (mask & 8) ssd1331.fillRect(x + t, y + h - t, w - 2 * t, t, c)
    if (mask & 16) ssd1331.fillRect(x, mid + t, t, lower, c)
    if (mask & 32) ssd1331.fillRect(x, y + t, t, upper, c)
    if (mask & 64) ssd1331.fillRect(x + t, mid, w - 2 * t, t, c)
}

function segWidth(s: string, w: number, t: number, gap: number): number {
    let width = 0
    for (let i = 0; i < s.length; i++) {
        if (i > 0) width += gap
        width += s.charAt(i) == "." ? t : w
    }
    return width
}

// Zeichnet Ziffern, "." und "-" und gibt die x-Position dahinter zurück
function drawSegNumber(s: string, x: number, y: number, w: number, h: number, t: number, gap: number, c: number): number {
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i)
        if (ch == ".") {
            ssd1331.fillRect(x, y + h - t, t, t, c)
            x += t + gap
        } else {
            const d = "0123456789".indexOf(ch)
            drawSegments(d >= 0 ? SEGMENTS[d] : MINUS, x, y, w, h, t, c)
            x += w + gap
        }
    }
    return x
}

// --- Kleine Schrift und Symbole -------------------------------------------
function glyph(ch: string): string[] {
    switch (ch) {
        case "C": return ["###", "#..", "#..", "#..", "###"]
        case "O": return ["###", "#.#", "#.#", "#.#", "###"]
        case "P": return ["###", "#.#", "###", "#..", "#.."]
        case "M": return ["#...#", "##.##", "#.#.#", "#...#", "#...#"]
        case "2": return ["###", "..#", "###", "#..", "###"]
        case "%": return ["#.#", "..#", ".#.", "#..", "#.#"]
        case "°": return ["###", "#.#", "###"]
        default: return ["...", "...", "...", "...", "..."]
    }
}

const THERMOMETER = [
    ".###.",
    ".#.#.",
    ".#.#.",
    ".###.",
    ".###.",
    ".###.",
    "#####",
    "#####",
    "#####",
    ".###."
]

const DROP = [
    "..#..",
    "..#..",
    ".###.",
    ".###.",
    "#####",
    "#####",
    "#####",
    ".###."
]

function drawBitmap(rows: string[], x: number, y: number, c: number): number {
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r]
        for (let col = 0; col < row.length; col++) {
            if (row.charAt(col) == "#") ssd1331.setPixel(x + col, y + r, c)
        }
    }
    return x + rows[0].length
}

function textWidth(s: string): number {
    let width = 0
    for (let i = 0; i < s.length; i++) {
        if (i > 0) width += 1
        width += glyph(s.charAt(i))[0].length
    }
    return width
}

function drawText(s: string, x: number, y: number, c: number): number {
    for (let i = 0; i < s.length; i++) {
        x = drawBitmap(glyph(s.charAt(i)), x, y, c) + 1
    }
    return x
}

// --- Anzeige ---------------------------------------------------------------
const BIG_W = 8, BIG_H = 20, BIG_T = 2, BIG_GAP = 2
const SMALL_W = 6, SMALL_H = 11, SMALL_T = 1, SMALL_GAP = 1
const BOTTOM_Y = 53

function formatTemperature(t: number): string {
    const t10 = Math.round(t * 10)
    const a = Math.abs(t10)
    return (t10 < 0 ? "-" : "") + Math.idiv(a, 10) + "." + (a % 10)
}

function draw(co2: number, temperature: number, humidity: number): void {
    ssd1331.clear()
    drawArc(co2)

    // "CO2" mit tiefgestellter 2
    const lx = drawText("CO", 42, 11, TEXT)
    drawText("2", lx, 13, TEXT)

    // CO2-Wert, mittig im Bogen ("----" solange noch kein Messwert da ist)
    const value = co2 > 0 ? "" + co2 : "----"
    const vw = segWidth(value, BIG_W, BIG_T, BIG_GAP)
    drawSegNumber(value, (ssd1331.WIDTH - vw) >> 1, 20, BIG_W, BIG_H, BIG_T, BIG_GAP, TEXT)

    drawText("PPM", (ssd1331.WIDTH - textWidth("PPM")) >> 1, 43, TEXT)

    // Temperatur unten links
    let x = drawBitmap(THERMOMETER, 0, BOTTOM_Y + 1, TEXT) + 2
    x = drawSegNumber(formatTemperature(temperature), x, BOTTOM_Y, SMALL_W, SMALL_H, SMALL_T, SMALL_GAP, TEXT)
    x = drawText("°", x + 1, BOTTOM_Y, TEXT)
    drawText("C", x, BOTTOM_Y + 6, TEXT)

    // Luftfeuchtigkeit unten rechts
    const h = "" + Math.round(humidity)
    x = ssd1331.WIDTH - textWidth("%") - 1 - segWidth(h, SMALL_W, SMALL_T, SMALL_GAP) - 2 - DROP[0].length
    x = drawBitmap(DROP, x, BOTTOM_Y + 2, TEXT) + 2
    x = drawSegNumber(h, x, BOTTOM_Y, SMALL_W, SMALL_H, SMALL_T, SMALL_GAP, TEXT)
    drawText("%", x, BOTTOM_Y + 6, TEXT)

    ssd1331.show()
}

ssd1331.init()
setupArc()
draw(0, 0, 0)

basic.forever(function () {
    // Der SCD40 liefert alle 5 Sekunden einen neuen Messwert
    const co2 = SCD40.get_co2()
    const temperature = SCD40.get_temperature()
    const humidity = SCD40.get_relative_humidity()
    draw(co2, temperature, humidity)
    basic.pause(5000)
})
