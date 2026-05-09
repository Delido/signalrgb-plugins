/**
 * Corsair Vanguard Pro 96 (PID 0x2B0E) — SignalRGB Plugin (wired only)
 *
 * Standalone plugin for Corsair's "Bragi v2" generation. Diverges from the
 * upstream Corsair_Bragi_Device.js because the wire format has changed:
 *   classic Bragi:  [0x00, deviceID|0x08, opcode, ...]            — old K-series
 *   Bragi v2:       [0x00, 0x00, 0x01, conn, opcode, ...]         — Vanguard Pro 96
 * Plus a mandatory 0x1B handshake before any command is honored, and a 5-step
 * layout-config upload that programs the per-key LED-slot table on the device
 * before the steady-state 0x12-subheader RGB stream is accepted. See
 * dumps/corsair_keyboard/PROTOCOL.md for the full protocol notes and
 * dumps/corsair_keyboard/icue_static_colors_disable_playmode.pcapng for the
 * canonical iCUE bring-up that this plugin replays verbatim at Initialize.
 *
 * Layout: ISO/DE 96-key with 6 side macro keys and an LCD strip. The wire
 * payload carries 133 RGB triplets per frame, of which 103 map to physical
 * LEDs (97 main + 6 side) and 30 are firmware-side gaps. The LCD lives on a
 * separate handle and is not driven by Stage 1.
 */

export function Name() { return "Corsair Vanguard Pro 96"; }
export function VendorId() { return 0x1B1C; }
export function ProductId() { return [0x2B0E]; }
export function Publisher() { return "Delido"; }
export function Documentation() { return "troubleshooting/corsair"; }
export function Size() { return [22, 6]; }
export function DefaultPosition() { return [0, 0]; }
export function DefaultScale() { return 1.0; }
export function DeviceType() { return "keyboard"; }
export function ImageUrl() { return "https://assets.signalrgb.com/devices/brands/corsair/keyboards/k65-plus.png"; }

/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
*/
export function ControllableParameters() {
	return [
		{ "property": "shutdownColor", "group": "lighting", "label": "Shutdown Color", "description": "Color applied when SignalRGB shuts down (system suspend always sends black)", "min": "0", "max": "360", "type": "color", "default": "#000000" },
		{ "property": "LightingMode", "group": "lighting", "label": "Lighting Mode", "description": "Canvas pulls from the active effect; Forced applies a single color", "type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas" },
		{ "property": "forcedColor", "group": "lighting", "label": "Forced Color", "description": "Color used when Lighting Mode is set to Forced", "min": "0", "max": "360", "type": "color", "default": "#009bde" },
	];
}

/**
 * Buffer reality (decoded from icue_static_colors_disable_playmode.pcapng,
 * dumps/corsair_keyboard/analysis/decode_rgb_buffer.py): 133 RGB triplets.
 * 30 of those slots are firmware-side gaps (no physical LED wired up); the
 * remaining 103 are real keys (97 main + 6 side macros + Elgato, no RCtrl).
 *
 * The slot-to-key mapping below is derived from a phone-video recording of
 * the plugin's `LayoutTestMode` sweep on the user's ISO/DE Vanguard Pro 96
 * (see PROTOCOL.md "Stage 2: layout calibration"). The firmware-buffer
 * order is *not* HID-keycode-aligned — it's a Vanguard-specific permutation
 * with three big gap regions used for paths the wired keyboard doesn't
 * have (function-row indicators, additional macro/zone slots, second
 * lighting handle pre-allocations).
 */
const TOTAL_BUFFER_SLOTS = 133;

/**
 * Each entry: [buffer_slot, name, [grid_x, grid_y]].
 * Slots not listed are firmware-side phantoms and are zeroed in the wire payload.
 */
const KEY_TABLE = [
	// Letters (DE keyboard slot order from the test sweep)
	[ 0, "A",          [ 2, 3]],
	[ 1, "B",          [ 7, 4]],
	[ 2, "C",          [ 5, 4]],
	[ 3, "D",          [ 4, 3]],
	[ 4, "E",          [ 4, 2]],
	[ 5, "F",          [ 5, 3]],
	[ 6, "G",          [ 6, 3]],
	[ 7, "H",          [ 7, 3]],
	[ 8, "I",          [ 9, 2]],
	[ 9, "J",          [ 8, 3]],
	[10, "K",          [ 9, 3]],
	[11, "L",          [10, 3]],
	[12, "M",          [ 9, 4]],
	[13, "N",          [ 8, 4]],
	[14, "O",          [10, 2]],
	[15, "P",          [11, 2]],
	[16, "Q",          [ 2, 2]],
	[17, "R",          [ 5, 2]],
	[18, "S",          [ 3, 3]],
	[19, "T",          [ 6, 2]],
	[20, "U",          [ 8, 2]],
	[21, "V",          [ 6, 4]],
	[22, "W",          [ 3, 2]],
	[23, "X",          [ 4, 4]],
	[24, "Z",          [ 7, 2]],   // DE: Z is on the top row near U (where ANSI has Y)
	[25, "Y",          [ 3, 4]],   // DE: Y sits where ANSI Z is, bottom row
	// Number row
	[26, "1",          [ 2, 1]],
	[27, "2",          [ 3, 1]],
	[28, "3",          [ 4, 1]],
	[29, "4",          [ 5, 1]],
	[30, "5",          [ 6, 1]],
	[31, "6",          [ 7, 1]],
	[32, "7",          [ 8, 1]],
	[33, "8",          [ 9, 1]],
	[34, "9",          [10, 1]],
	[35, "0",          [11, 1]],
	// "Big" keys
	[36, "Enter",      [14, 3]],   // ISO Enter spans rows 2-3; we anchor at row 3
	[37, "Esc",        [ 1, 0]],
	[38, "Backspace",  [14, 1]],
	[39, "Tab",        [ 1, 2]],
	[40, "Space",      [ 6, 5]],
	// DE punctuation row right
	[41, "ß",          [12, 1]],
	[42, "´",          [13, 1]],
	[43, "Ü",          [12, 2]],
	[44, "+",          [13, 2]],
	// 45 — phantom
	[46, "#",          [13, 3]],
	[47, "Ö",          [11, 3]],
	[48, "Ä",          [12, 3]],
	[49, "^",          [ 1, 1]],   // top-left of number row, the °/^ key
	[50, ",",          [10, 4]],
	[51, ".",          [11, 4]],
	[52, "-",          [12, 4]],
	[53, "CapsLock",   [ 1, 3]],
	// F-row
	[54, "F1",         [ 2, 0]],
	[55, "F2",         [ 3, 0]],
	[56, "F3",         [ 4, 0]],
	[57, "F4",         [ 5, 0]],
	[58, "F5",         [ 6, 0]],
	[59, "F6",         [ 7, 0]],
	[60, "F7",         [ 8, 0]],
	[61, "F8",         [ 9, 0]],
	[62, "F9",         [10, 0]],
	[63, "F10",        [11, 0]],
	[64, "F11",        [12, 0]],
	[65, "F12",        [13, 0]],
	[66, "Print Screen",[14, 0]],
	// 67-71 — phantom (5)
	[72, "Del",        [15, 1]],
	// 73-74 — phantom (2)
	[75, "Right Arrow",[17, 5]],
	[76, "Left Arrow", [15, 5]],
	[77, "Down Arrow", [16, 5]],
	[78, "Up Arrow",   [16, 4]],
	// Numpad
	[79, "NumLock",    [18, 1]],
	[80, "Num /",      [19, 1]],
	[81, "Num *",      [20, 1]],
	[82, "Num -",      [21, 1]],
	[83, "Num +",      [21, 2]],
	[84, "Num Enter",  [21, 4]],
	[85, "Num 1",      [18, 4]],
	[86, "Num 2",      [19, 4]],
	[87, "Num 3",      [20, 4]],
	[88, "Num 4",      [18, 3]],
	[89, "Num 5",      [19, 3]],
	[90, "Num 6",      [20, 3]],
	[91, "Num 7",      [18, 2]],
	[92, "Num 8",      [19, 2]],
	[93, "Num 9",      [20, 2]],
	[94, "Num 0",      [18, 5]],
	[95, "Num ,",      [19, 5]],   // DE numpad uses comma instead of period
	// ISO key
	[96, "ISO_<",      [ 2, 4]],   // <>| key between LShift and Y
	// 97-100 — phantom (4)
	[101, "Left Ctrl",  [ 1, 5]],
	[102, "Left Shift", [ 1, 4]],
	[103, "Left Alt",   [ 3, 5]],
	[104, "Left Win",   [ 2, 5]],
	// 105 — phantom
	[106, "Right Shift",[13, 4]],
	[107, "Right Alt",  [ 9, 5]],   // AltGr
	// 108-117 — phantom (10)
	[118, "Fn",         [11, 5]],
	// 119-125 — phantom (7)
	// Side panel + dedicated buttons (top-left lighting button + 5 macro keys + Elgato)
	[126, "LightFn",    [ 0, 0]],
	[127, "G1",         [ 0, 1]],
	[128, "G2",         [ 0, 2]],
	[129, "G3",         [ 0, 3]],
	[130, "G4",         [ 0, 4]],
	[131, "G5",         [ 0, 5]],
	[132, "Elgato",     [12, 5]],   // dedicated Stream Deck button right next to Fn
];

const ACTIVE_LEDS = KEY_TABLE.length;

/** Buffer slot for each active LED, indexed by `ledNames` order. */
const LED_BUFFER_INDEX = KEY_TABLE.map(e => e[0]);
const ledNames = KEY_TABLE.map(e => e[1]);
const ledPositions = KEY_TABLE.map(e => e[2]);

export function LedNames() { return ledNames; }
export function LedPositions() { return ledPositions; }

/**
 * Match the iCUE control channel of the Vanguard Pro 96.
 * - Interface 2 / usage 0x0001 / page 0xFF42 = bidirectional 1024-byte command channel
 * - Interface 3 / usage 0x0002 / page 0xFF42 = small notification/event channel (we don't drive lighting through this)
 * @param {HidEndpoint} endpoint
 */
export function Validate(endpoint) {
	return endpoint.usage_page === 0xFF42 && (
		(endpoint.interface === 2 && endpoint.usage === 0x0001) ||
		(endpoint.interface === 3 && endpoint.usage === 0x0002)
	);
}

export function Initialize() {
	device.set_endpoint(2, 0x0001, 0xFF42);
	bragi.ensureBufferLengths();
	bragi.replayInit();
}

export function Render() {
	bragi.writeLighting(buildRgbBuffer());
}

export function Shutdown(SystemSuspending) {
	const finalColor = SystemSuspending ? [0, 0, 0] : hexToRgb(shutdownColor);
	const buf = new Array(ACTIVE_LEDS * 3);
	for (let i = 0; i < ACTIVE_LEDS; i++) {
		buf[i * 3] = finalColor[0];
		buf[i * 3 + 1] = finalColor[1];
		buf[i * 3 + 2] = finalColor[2];
	}
	bragi.writeLighting(buf, true);
	device.pause(20);
	bragi.setMode(0x01); // Hardware
}

function buildRgbBuffer() {
	const buf = new Array(ACTIVE_LEDS * 3);
	const forced = LightingMode === "Forced" ? hexToRgb(forcedColor) : null;
	for (let i = 0; i < ACTIVE_LEDS; i++) {
		const c = forced || device.color(ledPositions[i][0], ledPositions[i][1]);
		buf[i * 3] = c[0];
		buf[i * 3 + 1] = c[1];
		buf[i * 3 + 2] = c[2];
	}
	return buf;
}

function hexToRgb(hex) {
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function hexStringToBytes(s) {
	const out = new Array(s.length / 2);
	for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.substr(i, 2), 16);
	return out;
}

/**
 * Lighting frame header, written verbatim by iCUE for every steady-state
 * RGB packet. The subsequent 132 RGB triplets fill positions 23..421 of the
 * 1024-byte wire payload; one trailing triplet at 422..424 was observed in
 * static-mode iCUE captures (always zero) and is preserved for parity.
 *
 *   00 01 02 06           - dir=request, conn=secondary, opcode=writeEndpoint
 *   00                    - lighting handle (0)
 *   9D 01 00 00           - len32 LE = 413
 *   12                    - sub-header marker (constant in every Vanguard frame)
 *   00 × 13               - sub-header padding
 */
const LIGHTING_HEADER = Object.freeze([
	0x00, // SDK report-ID prefix (stripped before wire)
	0x00, 0x01, 0x02, 0x06, 0x00,
	0x9D, 0x01, 0x00, 0x00,
	0x12,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

class BragiV2Keyboard {
	constructor() {
		this.writeLen = 1024;
		this.readLen = 1024;
		this.bufferLengthsResolved = false;

		// iCUE pushes lighting at ~24 fps continuously even for static effects.
		// Going faster causes Windows "Überlappender E/A-Vorgang" pile-ups and
		// eventually breaks key input on the keyboard. Throttle to 25 fps and
		// stream every frame (the device does NOT latch — a 1 Hz heartbeat is
		// not enough; without a fresh write every ~40 ms it reverts to the
		// firmware-default lighting).
		this.minIntervalMs = 40;
		this.lastWriteAt = 0;
		this.frameCounter = 0;
	}

	ensureBufferLengths() {
		if (this.bufferLengthsResolved) return;
		try {
			const info = device.getHidInfo();
			if (info && info.writeLength) this.writeLen = info.writeLength;
			if (info && info.readLength) this.readLen = info.readLength;
		} catch (e) {
			device.log(`Vanguard Pro 96: getHidInfo unavailable (${e}), using 1024-byte default`);
		}
		this.bufferLengthsResolved = true;
		device.log(`Vanguard Pro 96: buffer write=${this.writeLen} read=${this.readLen}`);
	}

	/**
	 * Replay the iCUE bring-up sequence (88 packets, captured verbatim from
	 * `dumps/corsair_keyboard/icue_static_colors_disable_playmode.pcapng`).
	 * After this completes, handle 0 is open on endpoint 0x22 (the
	 * LightingController endpoint) and the device is ready to accept the
	 * steady-state `0x12`-subheader RGB stream. Without this dance the device
	 * answers every command with status `0x0F` and silently drops lighting.
	 */
	replayInit() {
		device.log(`Vanguard Pro 96: replaying iCUE bring-up (${INIT_PACKETS_HEX.length} packets)`);
		for (let i = 0; i < INIT_PACKETS_HEX.length; i++) {
			const wireBytes = hexStringToBytes(INIT_PACKETS_HEX[i]);
			// Prepend the SDK report-ID slot (stripped before wire).
			device.write([0x00, ...wireBytes], this.writeLen);
			device.pause(15);
			// Drain any response so the next read isn't polluted.
			device.clearReadBuffer();
		}
		device.log(`Vanguard Pro 96: bring-up complete, RGB stream taking over`);
	}

	setMode(modeByte) {
		// [00 00 01 02 01 03 00 mode] — setProperty(mode) on conn=0x02 with the
		// Bragi v2 wire layout. modeByte = 0x01 (Hardware) or 0x02 (Software).
		const packet = [0x00, 0x00, 0x01, 0x02, 0x01, 0x03, 0x00, modeByte & 0xFF];
		device.write(packet, this.writeLen);
		device.pause(20);
		device.clearReadBuffer();
	}

	writeLighting(rgbData, force = false) {
		const now = Date.now();
		if (!force && now - this.lastWriteAt < this.minIntervalMs) return;

		// Distribute the 103 active LEDs across the 133-slot wire buffer,
		// leaving phantom slots zeroed.
		const wireBuf = new Array(TOTAL_BUFFER_SLOTS * 3).fill(0);
		for (let i = 0; i < ACTIVE_LEDS; i++) {
			const slot = LED_BUFFER_INDEX[i];
			wireBuf[slot * 3] = rgbData[i * 3];
			wireBuf[slot * 3 + 1] = rgbData[i * 3 + 1];
			wireBuf[slot * 3 + 2] = rgbData[i * 3 + 2];
		}

		this.writeWireBuffer(wireBuf);
	}

	writeWireBuffer(wireBuf) {
		device.write([...LIGHTING_HEADER, ...wireBuf], this.writeLen);
		this.lastWriteAt = Date.now();
		this.frameCounter++;

		if (this.frameCounter === 1 || this.frameCounter % 250 === 0) {
			device.log(`Vanguard Pro 96: lighting frame #${this.frameCounter} sent`);
		}
	}

}

// Init-packet replay table (auto-generated from icue_static_colors_disable_playmode.pcapng
// via dumps/corsair_keyboard/analysis/build_init_blob.py).  Each entry is the
// hex string of the on-wire bytes for one OUT packet, replayed verbatim with
// a leading 0x00 SDK-strip prefix.
const INIT_PACKETS_HEX = [
	"0001001b015753a574", // handshake (9 B) frame 101
	"00010101030002", // setProperty mode=Software conn=1 (7 B) frame 109
	"0001010d0024", // openEndpoint(handle=0, ep=0x24) (6 B) frame 115
	"0001010d0036", // openEndpoint(handle=0, ep=0x36) (6 B) frame 121
	"00010101030001", // setProperty mode=Hardware conn=1 — iCUE flips back briefly (7 B) frame 125
	"0001001b0152f0a196", // handshake (9 B) frame 141
	"0001021b020000000002", // session_op on conn=0x02 (10 B) frame 153
	"0001001b01e1f71bb3", // handshake (9 B) frame 157
	"00010201030002", // setProperty mode=Software conn=2 (7 B) frame 181
	"0001020d003d", // openEndpoint(handle=0, ep=0x3D) (6 B) frame 277
	"0001020501", // closeHandle (5 B) frame 289
	"0001020d003d", // openEndpoint(handle=0, ep=0x3D) — repeat (6 B) frame 293
	"0001020600c4030000440078006a6d6a6d000000006b6d6b6d000000006c6d6c6d000000006d6d6d6d000000006e6d6e6d000000006f6d6f6d00000000706d706d00000000716d716d00000000726d726d00000000736d736d00000000746d746d00000000756d756d00000000766d766d00000000776d776d00000000786d786d00000000796d796d000000007a6d7a6d000000007b6d7b6d000000007c6d7c6d000000007d6d7d6d000000007e6d7e6d000000007f6d7f6d00000000806d806d00000000816d816d00000000826d826d00000000836d836d00000000846d846d00000000856d856d00000000866d866d00000000876d876d00000000886d886d00000000896d896d000000008a6d8a6d000000008b6d8b6d000000008c6d8c6d000000008d6d8d6d000000008e6d8e6d000000008f6d8f6d00000000906d906d00000000916d916d00000000926d926d00000000936d936d00000000946d946d00000000956d956d00000000966d966d00000000976d976d00000000986d986d00000000996d996d000000009a6d9a6d000000009b6d9b6d000000009c6d9c6d000000009d6d9d6d000000009e6d9e6d000000009f6d9f6d00000000a06da06d00000000a16da16d00000000a26da26d00000000a36da36d00000000a46da46d00000000a56da56d00000000a66da66d00000000a76da76d00000000a86da86d00000000a96da96d00000000aa6daa6d00000000ab6dab6d00000000ac6dac6d00000000ad6dad6d00000000ae6dae6d00000000af6daf6d00000000b06db06d00000000b16db16d00000000b26db26d00000000b36db36d00000000b46db46d00000000b56db56d00000000b66db66d00000000b76db76d00000000b86db86d00000000b96db96d00000000ba6dba6d00000000bb6dbb6d00000000bc6dbc6d00000000bd6dbd6d00000000be6dbe6d00000000bf6dbf6d00000000c06dc06d00000000c16dc16d00000000c26dc26d00000000c36dc36d00000000c46dc46d00000000c56dc56d00000000c66dc66d00000000c76dc76d00000000c86dc86d00000000c96dc96d00000000ca6dca6d00000000cb6dcb6d00000000cc6dcc6d00000000cd6dcd6d00000000ce6dce6d00000000cf6dcf6d00000000d06dd06d00000000d16dd16d00000000d26dd26d00000000d36dd36d00000000d46dd46d00000000d56dd56d00000000d66dd66d00000000d76dd76d00000000d86dd86d00000000d96dd96d00000000da6dda6d00000000db6ddb6d00000000dc6ddc6d00000000dd6ddd6d00000000de6dde6d00000000df6ddf6d00000000e06de06d00000000e16de16d", // writeEndpoint subhdr=0x44 (969 B) frame 301
	"0001020501", // closeHandle (5 B) frame 305
	"0001020d0032", // openEndpoint ep=0x32 (6 B) frame 389
	"0001020600260100003000613701143201143b01145a01147a01142801145201140601140901144101146401142001142301146f01145901144501140e01145f01141b01140d01145401141d01142e01142601142f01141e01142c01146e01143001142201140a01141f01145101140501145301145601143301140c01146a01143501144601145501143a01143c01142101140401141201146301146b01145d01142d01141101142701140f01144301140b01143601144201145001142501141c01144f01141401141501144001143901141701141801144c01141a01142b01142a01146201141301143401140801145b01141001146c01143e01144401148801146101145e01145c01140701141601146001142901143d01145701141901142401143801146901143f0114580114", // writeEndpoint subhdr=0x30 layout-config (303 B) frame 397
	"0001020501", // closeHandle (5 B) frame 401
	"0001020d0033", // openEndpoint ep=0x33 (6 B) frame 405
	"0001020600260100003000613700233200233b00235a00237a00232800235200230600230900234100236400232000232300236f00235900234500230e00235f00231b00230d00235400231d00232e00232600232f00231e00232c00236e00233000232200230a00231f00235100230500235300235600233300230c00236a00233500234600235500233a00233c00232100230400231200236300236b00235d00232d00231100232700230f00234300230b00233600234200235000232500231c00234f00231400231500234000233900231700231800234c00231a00232b00232a00236200231300233400230800235b00231000236c00233e00234400238800236100235e00235c00230700231600236000232900233d00235700231900232400233800236900233f0023580023", // writeEndpoint subhdr=0x30 layout-config (303 B) frame 413
	"0001020501", // closeHandle (5 B) frame 417
	"0001020d0038", // openEndpoint ep=0x38 (6 B) frame 421
	"0001020600260100003000613701133201133b01135a01137a01132801135201130601130901134101136401132001132301136f01135901134501130e01135f01131b01130d01135401131d01132e01132601132f01131e01132c01136e01133001132201130a01131f01135101130501135301135601133301130c01136a01133501134601135501133a01133c01132101130401131201136301136b01135d01132d01131101132701130f01134301130b01133601134201135001132501131c01134f01131401131501134001133901131701131801134c01131a01132b01132a01136201131301133401130801135b01131001136c01133e01134401138801136101135e01135c01130701131601136001132901133d01135701131901132401133801136901133f0113580113", // writeEndpoint subhdr=0x30 layout-config (303 B) frame 429
	"0001020501", // closeHandle (5 B) frame 433
	"0001020d0039", // openEndpoint ep=0x39 (6 B) frame 437
	"0001020600260100003000613700223200223b00225a00227a00222800225200220600220900224100226400222000222300226f00225900224500220e00225f00221b00220d00225400221d00222e00222600222f00221e00222c00226e00223000222200220a00221f00225100220500225300225600223300220c00226a00223500224600225500223a00223c00222100220400221200226300226b00225d00222d00221100222700220f00224300220b00223600224200225000222500221c00224f00221400221500224000223900221700221800224c00221a00222b00222a00226200221300223400220800225b00221000226c00223e00224400228800226100225e00225c00220700221600226000222900223d00225700221900222400223800226900223f0022580022", // writeEndpoint subhdr=0x30 layout-config (303 B) frame 445
	"0001020501", // closeHandle (5 B) frame 449
	"0001020d003a", // openEndpoint ep=0x3A (6 B) frame 453
	"0001020600e80100003600613700140a0a3200140a0a3b00140a0a5a00140a0a7a00140a0a2800140a0a5200140a0a0600140a0a0900140a0a4100140a0a6400140a0a2000140a0a2300140a0a6f00140a0a5900140a0a4500140a0a0e00140a0a5f00140a0a1b00140a0a0d00140a0a5400140a0a1d00140a0a2e00140a0a2600140a0a2f00140a0a1e00140a0a2c00140a0a6e00140a0a3000140a0a2200140a0a0a00140a0a1f00140a0a5100140a0a0500140a0a5300140a0a5600140a0a3300140a0a0c00140a0a6a00140a0a3500140a0a4600140a0a5500140a0a3a00140a0a3c00140a0a2100140a0a0400140a0a1200140a0a6300140a0a6b00140a0a5d00140a0a2d00140a0a1100140a0a2700140a0a0f00140a0a4300140a0a0b00140a0a3600140a0a4200140a0a5000140a0a2500140a0a1c00140a0a4f00140a0a1400140a0a1500140a0a4000140a0a3900140a0a1700140a0a1800140a0a4c00140a0a1a00140a0a2b00140a0a2a00140a0a6200140a0a1300140a0a3400140a0a0800140a0a5b00140a0a1000140a0a6c00140a0a3e00140a0a4400140a0a8800140a0a6100140a0a5e00140a0a5c00140a0a0700140a0a1600140a0a6000140a0a2900140a0a3d00140a0a5700140a0a1900140a0a2400140a0a3800140a0a6900140a0a3f00140a0a5800140a0a", // writeEndpoint subhdr=0x36 layout-config (497 B) frame 461
	"0001020501", // closeHandle (5 B) frame 465
	"0001020d0048", // openEndpoint ep=0x48 (6 B) frame 497
	"0001020501", // closeHandle (5 B) frame 509
	"00010201fb", // setProperty 0xFB (5 B) frame 513
	"00010201fc0001", // setProperty 0xFC = 1 (7 B) frame 517
	"00010201fe0004", // setProperty 0xFE = 4 (7 B) frame 521
	"00010201ff0007", // setProperty 0xFF = 7 (7 B) frame 525
	"0001020d000f", // openEndpoint ep=0x0F (6 B) frame 537
	"0001020501", // closeHandle (5 B) frame 549
	"0001020501", // closeHandle (5 B) frame 565
	"0001020501", // closeHandle (5 B) frame 581
	"0001020501", // closeHandle (5 B) frame 597
	"0001020501", // closeHandle (5 B) frame 613
	"0001020501", // closeHandle (5 B) frame 629
	"0001020501", // closeHandle (5 B) frame 645
	"0001020501", // closeHandle (5 B) frame 661
	"0001020501", // closeHandle (5 B) frame 677
	"0001020501", // closeHandle (5 B) frame 693
	"0001020501", // closeHandle (5 B) frame 709
	"0001020d0025", // openEndpoint ep=0x25 (6 B) frame 713
	"0001020501", // closeHandle (5 B) frame 725
	"00010201090001", // setProperty 0x09 = 1 (7 B) frame 733
	"00010201390001", // setProperty 0x39 = 1 (7 B) frame 737
	"000102010a0005", // setProperty 0x0A = 5 (7 B) frame 741
	"00010201380005", // setProperty 0x38 = 5 (7 B) frame 745
	"000102014a0001", // setProperty 0x4A = 1 (7 B) frame 753
	"0001020d0032", // openEndpoint ep=0x32 (second pass) (6 B) frame 759
	"0001020501", // closeHandle (5 B) frame 771
	"0001020d0033", // openEndpoint ep=0x33 (second pass) (6 B) frame 775
	"0001020501", // closeHandle (5 B) frame 787
	"0001020d0038", // openEndpoint ep=0x38 (second pass) (6 B) frame 791
	"0001020501", // closeHandle (5 B) frame 803
	"0001020d0039", // openEndpoint ep=0x39 (second pass) (6 B) frame 807
	"0001020501", // closeHandle (5 B) frame 819
	"0001020d003a", // openEndpoint ep=0x3A (second pass) (6 B) frame 823
	"0001020501", // closeHandle (5 B) frame 835
	"00010201fb", // setProperty 0xFB (5 B) frame 843
	"00010201fc0001", // setProperty 0xFC = 1 (7 B) frame 847
	"00010201fe0004", // setProperty 0xFE = 4 (7 B) frame 851
	"00010201ff0007", // setProperty 0xFF = 7 (7 B) frame 855
	"0001020d004b", // openEndpoint ep=0x4B (6 B) frame 859
	"0001020501", // closeHandle (5 B) frame 871
	"0001020d0002", // openEndpoint ep=0x02 (6 B) frame 875
	"000102060089000000010101013939393939393939393939393939393939393939393939393939393939393939393939393b39393939393939390139393939393939393b3939393b3b3b3b3b3b3b393901010101013901013b3b3939393939393939393939393939393939393939010101013f3f3f39013f3f010101010101010101013f010101010101013939393939393b", // writeEndpoint subhdr=0x01 (146 B) frame 879
	"0001020501", // closeHandle (5 B) frame 883
	"0001020d0022", // openEndpoint ep=0x22 = LightingController — handle 0 stays open (6 B) frame 887
	// (frame 891 was the first 0x12-subhdr RGB frame; we let our own Render() take over from here)
	"0001020d012e", // openEndpoint handle=1, ep=0x2E — second lighting handle (edge bar) (6 B) frame 895
	"0001020601190200002b000000000000000000000000000000000400000000050000000006000000000700000000080000000009000000000a000000000b000000000c000000000d000000000e000000000f0000000010000000001100000000120000000013000000001400000000150000000016000000001700000000180000000019000000001a000000001b000000001c000000001d000000001e000000001f0000000020000000002100000000220000000023000000002400000000250000000026000000002700000000280000000029000000002a000000002b000000002c000000002d000000002e000000002f000000003000000000320000000033000000003400000000350000000036000000003700000000380000000039000000003a000000003b000000003c000000003d000000003e000000003f0000000040000000004100000000420000000043000000004400000000450000000046000000004c000000004f0000000050000000005100000000520000000053000000005400000000550000000056000000005700000000580000000059000000005a000000005b000000005c000000005d000000005e000000005f000000006000000000610000000062000000006300000000640000000069000000006a000000006b000000006c000000006e000000006f000000007a00000000000000000082000000008300000000840000000085000000008600000000870000000088", // writeEndpoint subhdr=0x2b — edge bar layout (542 B) frame 899
	"0001020d0202", // openEndpoint handle=2, ep=0x02 — third lighting handle (LCD) (6 B) frame 903
	"000102060289000000010101013939393939393939393939393939393939393939393939393939393939393939393939393b39393939393939390139393939393939393b3939393b3b3b3b3b3b3b393901010101013901013b3b3939393939393939393939393939393939393939010101013f3f3f39013f3f010101010101010101013f010101010101013939393939393b", // writeEndpoint subhdr=0x01 (146 B) frame 907
	"000102050102", // closeHandle handle=2 (6 B) frame 911
	"000102050102", // closeHandle handle=2 (6 B) frame 927
	"0001020d023e", // openEndpoint handle=2, ep=0x3E (6 B) frame 931
	"00010206027e000000660028003c00a66da76da86da96daa6dab6dac6dad6dae6daf6db06db16db26db36db46db56db66db76db86db96dba6dbb6dbc6dbd6dbe6dbf6dc06dc16dc26dc36dc46dc56dc66dc76dc86dc96dca6dcb6dcc6dcd6dce6dcf6dd06dd16dd26dd36dd46dd56dd66dd76dd86dd96dda6ddb6ddc6ddd6dde6ddf6de06de16d", // writeEndpoint subhdr=0x66 handle=2 (135 B) frame 939
	"000102050102", // closeHandle handle=2 (6 B) frame 943
	"0001020d0202", // openEndpoint handle=2, ep=0x02 (6 B) frame 947
	"000102060289000000010101013939393939393939393939393939393939393939393939393939393939393939393939393b39393939393939390139393939393939393b3939393b3b3b3b3b3b3b393901010101013901013b3b3939393939393939393939393939393939393939010101013f3f3f39013f3f010101010101010101013f010101010101013939393939393b", // writeEndpoint subhdr=0x01 (146 B) frame 951
	"000102050102", // closeHandle handle=2 (6 B) frame 955
];

const bragi = new BragiV2Keyboard();
