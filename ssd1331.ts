/**
 * Treiber für das Farb-OLED SSD1331 (0,95", 96x64, SPI) mit Bildpuffer.
 * Es wird zuerst in den Puffer gezeichnet und dann mit show() alles
 * auf einmal übertragen, so flackert die Anzeige nicht.
 *
 * Verkabelung:
 *   SCL → C13 (SCK), SDA → C15 (MOSI), RES → P3, DC → C8, CS → C9
 *   C14 bleibt frei (MISO, vom SPI belegt)
 */
namespace ssd1331 {
    export const WIDTH = 96
    export const HEIGHT = 64

    const CS = DigitalPin.C9
    const DC = DigitalPin.C8
    const RES = DigitalPin.P3
    const MOSI = DigitalPin.C15
    const MISO = DigitalPin.C14
    const SCK = DigitalPin.C13

    // Bildpuffer: RGB565, 2 Bytes pro Pixel (High-Byte zuerst), zeilenweise.
    // Aufgeteilt in Streifen zu je 8 Zeilen, denn ein einzelner 12-KB-Puffer
    // ist für die Speicherverwaltung zu groß (Fehler 022).
    export const BAND = 8
    export const BAND_PIXELS = WIDTH * BAND
    export const bands: Buffer[] = []
    for (let b = 0; b < HEIGHT / BAND; b++) bands.push(pins.createBuffer(BAND_PIXELS * 2))

    const INIT = [
        0xAE,        // Display aus
        0xA0, 0x72,  // Remap: 65k Farben, RGB
        0xA1, 0x00,  // Startzeile
        0xA2, 0x00,  // Offset
        0xA4,        // normale Anzeige
        0xA8, 0x3F,  // Multiplex 1/64
        0xAD, 0x8E,  // Master-Konfiguration
        0xB0, 0x0B,  // Stromsparen aus
        0xB1, 0x31,  // Phasenlänge
        0xB3, 0xF0,  // Taktteiler
        0x8A, 0x64,  // Precharge A
        0x8B, 0x78,  // Precharge B
        0x8C, 0x64,  // Precharge C
        0xBB, 0x3A,  // Precharge-Spannung
        0xBE, 0x3E,  // VCOMH
        0x87, 0x06,  // Master-Strom
        0x81, 0x91,  // Kontrast A (blau)
        0x82, 0x50,  // Kontrast B (grün)
        0x83, 0x7D,  // Kontrast C (rot)
        0xAF         // Display an
    ]

    function command(bytes: number[]): void {
        const buf = pins.createBuffer(bytes.length)
        for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i]
        pins.digitalWritePin(DC, 0)
        pins.digitalWritePin(CS, 0)
        pins.spiTransfer(buf, null)
        pins.digitalWritePin(CS, 1)
    }

    /**
     * Initialisiert das Display und löscht es.
     */
    export function init(): void {
        pins.spiPins(MOSI, MISO, SCK)
        pins.spiFormat(8, 0)
        pins.spiFrequency(4000000)
        pins.digitalWritePin(CS, 1)
        pins.digitalWritePin(RES, 1)
        basic.pause(5)
        pins.digitalWritePin(RES, 0)
        basic.pause(10)
        pins.digitalWritePin(RES, 1)
        basic.pause(10)
        for (const c of INIT) command([c])
        clear()
        show()
    }

    /**
     * Wandelt eine Farbe 0xRRGGBB in das 16-Bit-Format des Displays.
     */
    export function rgb(color: number): number {
        const r = (color >> 16) & 0xFF
        const g = (color >> 8) & 0xFF
        const b = color & 0xFF
        return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
    }

    /**
     * Löscht den Bildpuffer (schwarz).
     */
    export function clear(): void {
        for (const band of bands) band.fill(0)
    }

    /**
     * Setzt einen Pixel im Bildpuffer (Farbe im 565-Format, siehe rgb()).
     */
    export function setPixel(x: number, y: number, c: number): void {
        if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return
        const band = bands[Math.idiv(y, BAND)]
        const i = ((y % BAND) * WIDTH + x) * 2
        band[i] = c >> 8
        band[i + 1] = c & 0xFF
    }

    /**
     * Füllt ein Rechteck im Bildpuffer (Farbe im 565-Format).
     */
    export function fillRect(x: number, y: number, w: number, h: number, c: number): void {
        if (x < 0) { w += x; x = 0 }
        if (y < 0) { h += y; y = 0 }
        if (x + w > WIDTH) w = WIDTH - x
        if (y + h > HEIGHT) h = HEIGHT - y
        const hi = c >> 8
        const lo = c & 0xFF
        for (let yy = y; yy < y + h; yy++) {
            const band = bands[Math.idiv(yy, BAND)]
            let i = ((yy % BAND) * WIDTH + x) * 2
            for (let xx = 0; xx < w; xx++) {
                band[i] = hi
                band[i + 1] = lo
                i += 2
            }
        }
    }

    /**
     * Überträgt den Bildpuffer auf das Display.
     */
    export function show(): void {
        command([0x15, 0, WIDTH - 1, 0x75, 0, HEIGHT - 1])
        pins.digitalWritePin(DC, 1)
        pins.digitalWritePin(CS, 0)
        for (const band of bands) pins.spiTransfer(band, null)
        pins.digitalWritePin(CS, 1)
    }
}
