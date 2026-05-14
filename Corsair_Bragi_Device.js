import {Assert} from "@SignalRGB/Errors.js";
import DeviceDiscovery from "@SignalRGB/DeviceDiscovery";

export function Name() { return "Corsair Bragi Device"; }
export function VendorId() { return 0x1b1c; }
export function ProductId() { return Object.keys(CorsairLibrary.ProductIDList()); }
export function Publisher() { return "WhirlwindFX"; }
export function Documentation(){ return "troubleshooting/corsair"; }
// Both supported PIDs (Vanguard 96, Vanguard Pro 96) are 22x6 keyboards.
// Returning the real size as default lets SignalRGB initialise its canvas
// at the correct dimensions, which eliminates the `device.color(): Out of
// bounds` warnings that fire on the first render before setSize is async-
// applied.
export function Size() { return [22, 6]; }
export function DeviceType(){return "keyboard";}
export function ImageUrl() { return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
settingControl:readonly
dpiStages:readonly
dpi1:readonly
dpi2:readonly
dpi3:readonly
dpi4:readonly
dpi5:readonly
dpi6:readonly
dpiRollover:readonly
PollRate:readonly
dpiStages:readonly
ConnectedFans:readonly
FanControllerArray:readonly
gameMode:readonly
flashTap:readonly
fnHighlightColor:readonly
rapidTrigger:readonly
rapidTriggerSensitivity:readonly
actuationPoint:readonly
gameModePollRate:readonly
knobModeMedia:readonly
knobModeVerticalScroll:readonly
*/
export function ControllableParameters(){
    return [
        {"property":"shutdownColor", "group":"lighting", "label":"Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", "min":"0", "max":"360", "type":"color", "default":"#000000"},
        {"property":"LightingMode", "group":"lighting", "label":"Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", "type":"combobox", "values":["Canvas", "Forced"], "default":"Canvas"},
        {"property":"forcedColor", "group":"lighting", "label":"Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", "min":"0", "max":"360", "type":"color", "default":"#009bde"},
        {"property":"gameModeColor", "group":"lighting", "label":"Game Mode Color", description: "The color used when Game Mode is active. Leave at #000000 to use Forced Color setting", "min":"0", "max":"360", "type":"color", "default":"#FF0000"},
        {"property":"gameModeForceColor", "group":"lighting", "label":"Game Mode Forces Lighting", description: "When enabled, Game Mode will always use Forced Color mode (ignoring Canvas). When disabled, Game Mode respects the Lighting Mode setting", "type":"boolean", "default":"true"},
        {"property":"fnHighlightColor", "group":"", "label":"Fn Highlight Color", description: "Color the F1–F12 keys flash while Fn is held down. Set to #000000 to disable.", "min":"0", "max":"360", "type":"color", "default":"#FFFFFF"},
        {"property":"rapidTrigger", "group":"", "label":"Rapid Trigger", description:"Keys register based on direction of motion (press vs release) instead of a fixed depth. Reduces input lag for fast double-taps.", "type":"boolean", "default":false},
        {"property":"rapidTriggerSensitivity", "group":"", "label":"Rapid Trigger Sensitivity (mm)", description:"How far a key must move before it can re-trigger. Lower = faster repeated activations. Only effective while Rapid Trigger is on.", "type":"combobox", "values":["0.1","0.2","0.3","0.4","0.5","0.6","0.7","0.8","0.9","1.0"], "default":"0.1"},
        {"property":"actuationPoint", "group":"", "label":"Key Actuation Point (mm)", description:"How far a key must travel before it registers. Lower = more sensitive. Affects all keys. Only active while Game Mode is on.", "type":"combobox", "values":["0.3","0.4","0.5","0.6","0.7","0.8","0.9","1.0","1.1","1.2","1.3","1.4","1.5","1.6","1.7","1.8","1.9","2.0","2.1","2.2","2.3","2.4","2.5","2.6","2.7","2.8","2.9","3.0","3.1","3.2","3.3","3.4","3.5","3.6"], "default":"2.0"},
        {"property":"knobModeMedia", "group":"", "label":"Knob – Media Mode", description:"Include Media mode in the Fn+F12 cycle. Turn = Skip Forward/Backward, Push = Play/Pause.", "type":"boolean", "default":true},
        {"property":"knobModeVerticalScroll", "group":"", "label":"Knob – Vertical Scroll Mode", description:"Include Vertical Scroll mode in the Fn+F12 cycle. Turn = Page Up/Down. No push action.", "type":"boolean", "default":true},
    ];
}

// Mirror of the keyboard's hardware Game Mode state. Updated whenever the UI
// toggle changes OR the user presses the dedicated Game Mode key on the
// keyboard (bitIdx 130 in KeyboardKeyMapping). Used to make the physical
// key act as a real toggle — without iCUE running, the keyboard fires a
// notification but does NOT engage the lock itself; the host must echo
// `setProperty(0xE1)` for the firmware to act.
let gameModeActive = false;
const FLASHTAP_KEY_INDICES = new Set([56, 58]); // "A" = Index 56, "D" = Index 58

export let flashTap = false;
export let gameMode = false;


function hidRepeat(steps, code) {
    for (let i = 0; i < steps; i++) {
        keyboard.sendHid(code, { released: false });
        keyboard.sendHid(code, { released: true });
    }
}

// Knob modes. Each mode maps a firmware XX byte (drives the LCD label on
// the keyboard) to a JS action fired on knob turn / push. XX values and
// labels are user-verified by cycling (keyboard_functions.pcapng). Volume
// is intentionally first — hardcoded as always-enabled (see
// isKnobModeEnabled) so it can never disappear from the cycle.
const KNOB_MODES = Object.freeze([
    {
        name: "Volume",
        uiKey: "knobModeVolume",
        firmwareXX: 0x42,
        action: (delta) => hidRepeat(Math.abs(delta), delta > 0 ? 0xAF : 0xAE),
        pushAction: () => hidRepeat(1, 0xAD), // Mute toggle
    },
    {
        name: "Media",
        uiKey: "knobModeMedia",
        firmwareXX: 0x41,
        // Vanguard Pro 96 emits knob-push as bitIdx 129 (empirically
        // confirmed via diagnostic log, NOT the upstream Bragi 137).
        action: (delta) => hidRepeat(Math.abs(delta), delta > 0 ? 0xB0 : 0xB1),
        pushAction: () => hidRepeat(1, 0xB3), // Play/Pause
    },
    {
        name: "Vertical Scroll",
        uiKey: "knobModeVerticalScroll",
        firmwareXX: 0x3d,
        // No `mouse` global in a keyboard plugin → fall back to Page Up /
        // Page Down (0x21 = VK_PRIOR, 0x22 = VK_NEXT). Works in browsers,
        // PDF viewers, editors, scrollable lists.
        action: (delta) => hidRepeat(Math.abs(delta), delta > 0 ? 0x22 : 0x21),
        pushAction: null,
    },
]);
let knobModeIdx = 0;

// UI toggles are injected as bare globals by the SignalRGB runtime. They
// may not yet exist at module-load time → typeof guard. Volume has no UI
// toggle (always returns true) so it can never be filtered out.
function isKnobModeEnabled(mode) {
    switch (mode.uiKey) {
    case "knobModeVolume":         return true;
    case "knobModeMedia":          return typeof knobModeMedia          !== "undefined" ? !!knobModeMedia          : true;
    case "knobModeVerticalScroll": return typeof knobModeVerticalScroll !== "undefined" ? !!knobModeVerticalScroll : true;
    default: return true;
    }
}

function getEnabledKnobModes() {
    return KNOB_MODES.filter(isKnobModeEnabled);
}

function getKnobMode() {
    const enabled = getEnabledKnobModes();
    return enabled[knobModeIdx % enabled.length];
}

// 4-packet sequence captured from iCUE on conn=0x02 (FNF12.pcapng frames
// 19/23/27/31). sendAndRead waits for the firmware ACK between packets;
// without that, writeEndpoint races the handle-open and the FW silently
// drops the write.
function writeKnobMode(mode) {
    device.log(`Setting Knob Mode: ${mode.name} (firmware XX=0x${mode.firmwareXX.toString(16)})`);
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x0d, 0x02, 0x3e]);
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x09, 0x02, 0x00]);
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x06, 0x02,
        0x0b, 0x00, 0x00, 0x00,
        0x59, 0x00, 0x00, 0x00, 0x00,
        0xff, 0xff, 0xff,
        mode.firmwareXX,
        0x00, 0x00]);
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x05, 0x01, 0x02]);
}

function cycleFnMode() {
    const enabled = getEnabledKnobModes();
    // Clamp first, then advance — otherwise a mid-session UI disable could
    // leave knobModeIdx pointing past enabled.length and the next press
    // would land on the same mode twice in a row.
    knobModeIdx = (knobModeIdx % enabled.length + 1) % enabled.length;
    writeKnobMode(enabled[knobModeIdx]);
}

// SignalRGB calls on<property>Changed() right before the next Render after a
// UI toggle flips. If the currently-active knob mode just got disabled (or
// we'd otherwise drift out of sync with the firmware), resync: clamp the
// index and write the resolved mode to the keyboard so HW + LCD match.
function resyncKnobMode() {
    if (!wiredDevice) return; // guard against pre-Initialize() invocations
    const enabled = getEnabledKnobModes();
    knobModeIdx = knobModeIdx % enabled.length;
    writeKnobMode(enabled[knobModeIdx]);
}

export function onknobModeMediaChanged()          { resyncKnobMode(); }
export function onknobModeVerticalScrollChanged() { resyncKnobMode(); }

function setHardwareGameMode(enabled) {
    const requestedState = !!enabled;

    gameModeActive = requestedState;
    device.write([0x00, 0x00, 0x01, 0x02, 0x01, 0xE1, 0x00, gameModeActive ? 0x01 : 0x00], 1024);
    device.log(`Game Mode ${gameModeActive ? "engaged" : "released"} via v2 setProperty(0xE1)`);

    applyGameModeDependencies();
}

// Side-effects that have to run whenever gameModeActive changes — regardless
// of whether the change originated from a UI toggle, the physical GM key, or
// an EXTERNAL process writing setProperty(0xE1) over USB. Factored out of
// setHardwareGameMode so syncGameModeFromHardware() can apply them without
// re-issuing the GM write itself.
function applyGameModeDependencies() {
    if (!gameModeActive && flashTapActive) {
        device.log(`Game Mode disabled → FlashTap also disabled`);
        flashTapActive = false;
    }

    // If FlashTap is set in the UI but Game Mode was previously OFF, engage it now.
    if (gameModeActive && flashTap && !flashTapActive) {
        setHardwareFlashTap(true);
    }

    // Re-apply the actuation/RT block whenever Game Mode engages. Firmware
    // drops these writes silently outside Game Mode, so the user's chosen
    // actuation point only "sticks" once GM is active. Without this, a user
    // who never touches the UI after GM toggles would get the firmware
    // default (2.0mm) instead of their configured value.
    if (gameModeActive) {
        writeRapidTriggerConfig();
    }

    // Polling rate auto-switch. Only writes when:
    //   - settingControl is active (user wants us to manage this)
    //   - the target rate for the new mode is defined
    //   - it differs from the last-written value (avoids USB re-enumeration
    //     on every GM toggle when the rate didn't actually change)
    if (typeof settingControl !== "undefined" && settingControl) {
        const targetRate = gameModeActive
            ? (typeof gameModePollRate === "string" ? gameModePollRate : null)
            : (typeof PollRate === "string" ? PollRate : null);
        if (targetRate && targetRate !== _lastWrittenPollRate) {
            device.log(`Game Mode toggle → switching Polling Rate to [${targetRate}]`);
            setPollRate(targetRate);
        }
    }

    refreshKeyboardLighting();
}

// Detect Game Mode changes that originated OUTSIDE this plugin (e.g. an
// external tool writing setProperty(0xE1) directly). If the firmware state
// differs from our cached gameModeActive, we update the cache and run the
// dependency chain — polling rate, FlashTap, lighting — so the rest of the
// plugin behaves as if WE had triggered the toggle. Note: we cannot write
// back to the `gameMode` UI property; it will show stale state until the
// user reloads the plugin. The functional path (physical GM key, etc.)
// works correctly because it keys off gameModeActive, not gameMode.
function syncGameModeFromHardware() {
    try {
        const fwState = Corsair.FetchProperty(0xE1, 1);
        if (fwState !== 0 && fwState !== 1) return;
        const fwActive = (fwState === 1);
        if (fwActive === gameModeActive) return;
        device.log(`External Game Mode change detected: ${fwActive ? "ON" : "OFF"} (was ${gameModeActive ? "ON" : "OFF"})`);
        gameModeActive = fwActive;
        applyGameModeDependencies();
    } catch (e) {
        // FetchProperty can fail during a polling-rate reboot — silent.
    }
}

export function ongameModeChanged() {
    if (!wiredDevice) return;
    setHardwareGameMode(gameMode);
}

// Mirror of the keyboard's hardware FlashTap (SOCD) state. Same pattern as
// `gameModeActive`: kept in sync with both the UI toggle and the physical
// Fn + Right Shift chord on the keyboard.
let flashTapActive = false;

function setHardwareFlashTap(enabled) {
    if (!gameModeActive) {
        device.log(`FlashTap ${enabled ? "engage" : "release"} attempted but Game Mode is OFF — write will be IGNORED by the keyboard.`);
        return;
    }

    // FlashTap toggle: setProperty(propID=0x0100 LE16, value) on conn=0x02.
    // Bytes captured verbatim from
    // dumps/corsair_keyboard/flashtap_engage_disengage.pcapng (frame 1039
    // ENGAGE, frame 1051 DISENGAGE — same iCUE session, current firmware).
    // Earlier guess of conn=0x03 was wrong: ENGAGE happened to take effect
    // there too (firmware tolerance) but DISENGAGE was silently dropped,
    // so the LCD got stuck in the on state. iCUE itself uses conn=0x02 for
    // both directions.
    flashTapActive = !!enabled;
    device.write([0x00, 0x00, 0x01, 0x02, 0x01, 0x00, 0x01, flashTapActive ? 0x01 : 0x00], 1024);
    device.log(`FlashTap ${flashTapActive ? "engaged" : "released"} via setProperty(0x0100) on conn=0x02`);

    refreshKeyboardLighting();
}

function refreshKeyboardLighting() {
    if (wiredDevice) {
        UpdateRGB(wiredDevice);
    }

    if (BragiDongle) {
        for (const [key, value] of BragiDongle.children) {
            UpdateRGB(value, key);
        }
    }
}

// Rapid-Trigger / Key-Actuation Konfiguration. iCUE bündelt alle
// Tasten-Betätigungs-Settings in einem 14-byte writeEndpoint auf
// endpoint 0x48 (handle 0x02, conn=0x02). Aus den Captures:
//   rapidtrigger_main_disable.pcapng + main_enable.pcapng:
//     byte 10 = Rapid Trigger Enable Flag
//   rapidtrigger_sensitivity_1.0mm.pcapng vs main_enable (=0.1mm):
//     bytes 12 + 13 = Press/Release-Sensitivity in 1/10mm
// Die anderen Bytes (3, 5, 6, 7, 9, 11) gehören zu Primärer/Sekundärer/
// Reset-Konfiguration und werden hier mit den iCUE-Default-Werten
// (Primary=2.0mm, Sekundär OFF) gesendet. Wir senden bei jedem UI-Change.
function writeRapidTriggerConfig() {
    const sensitivityValue = (typeof rapidTriggerSensitivity === "string")
        ? parseFloat(rapidTriggerSensitivity) : Number(rapidTriggerSensitivity);
    const sens10 = Math.max(1, Math.min(10, Math.round(sensitivityValue * 10)));
    const rtFlag = rapidTrigger ? 0x01 : 0x00;

    // Actuation point in 1/10mm. UI dropdown spans 0.3–3.6mm matching iCUE.
    // Clamp defensively in case the property is missing or malformed.
    const actuationStr = (typeof actuationPoint === "string") ? actuationPoint : "2.0";
    const actuation10 = Math.max(3, Math.min(36, Math.round(parseFloat(actuationStr) * 10)));

    // Byte 5 ("sec clamp") tracks the actuation point in the iCUE captures.
    // Empirical formula from comparing 1mm vs 1mm+RT vs 2mm captures: the
    // value follows the primary actuation × 10 but clamped to a small upper
    // range. iCUE's exact algorithm isn't fully reverse-engineered yet; this
    // approximation matches the two new captures (1mm → 0x13 without RT,
    // 0x09 with RT 0.5mm). Use the captured value verbatim when possible.
    const secClamp = rtFlag ? 0x09 : 0x13;

    // 14-byte payload — same shape as rapidtrigger_main_enable.pcapng and
    // the new tastenbestätigung_im_gamemode_1mm[_mit_rapittrigger_0.5mm]
    // captures. Byte 3 + byte 11 = primary actuation (always identical),
    // byte 10 = RT enable, byte 12/13 = RT sensitivity, byte 5 = sec clamp.
    const payload = [
        0x63, 0x00, 0x01,
        actuation10, // byte 3: Primärer Betätigungspunkt
        0x00,
        secClamp,    // byte 5: sec clamp (changes with RT enable in iCUE captures)
        0x00,        // byte 6: Sekundärer Bestätigungspunkt = OFF
        0x25, 0x00, 0x22,  // bytes 7-9: iCUE-defaults
        rtFlag,      // byte 10: Rapid Trigger Enable
        actuation10, // byte 11: duplicate of byte 3
        sens10,      // byte 12: Press Sensitivity (×10 mm)
        sens10,      // byte 13: Release Sensitivity (×10 mm, identical when "Separate Sens" off)
    ];

    // 4-packet sequence: open / check / write / close on handle=0x02, endpoint=0x48
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x0d, 0x02, 0x48]);
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x09, 0x02, 0x00]);
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x06, 0x02,
        0x0e, 0x00, 0x00, 0x00].concat(payload));
    sendAndRead([0x00, 0x00, 0x01, 0x02, 0x05, 0x01, 0x02]);

    device.log(`Actuation @ ${(actuation10/10).toFixed(1)}mm — Rapid Trigger ${rtFlag ? "ENGAGED" : "RELEASED"} @ ${(sens10/10).toFixed(1)}mm sensitivity` + (gameModeActive ? "" : " — WARNING: Game Mode OFF, firmware will ignore"));
}

export function onrapidTriggerChanged() {
    writeRapidTriggerConfig();
}

export function onrapidTriggerSensitivityChanged() {
    writeRapidTriggerConfig();
}

export function onactuationPointChanged() {
    writeRapidTriggerConfig();
}

const devFlags = false;

export function SubdeviceController() { return devFlags; } //Fix DPI Logic. If you remove too many stages, it blows up.

export function onsettingControlChanged() {
	if(settingControl) {
		DPIHandler.setActiveControl(true);
		DPIHandler.update();
		setPollRate(PollRate);
	} else {
		DPIHandler.setActiveControl(false);
	}
}

export function ondpiStagesChanged() {
	DPIHandler.setMaxStageCount(dpiStages);
	DPIHandler.update();
}

export function ondpiRolloverChanged() {
	DPIHandler.setRollover(dpiRollover);
}

export function ondpi1Changed() {
	DPIHandler.DPIStageUpdated(1);
}

export function ondpi2Changed() {
	DPIHandler.DPIStageUpdated(2);
}

export function ondpi3Changed() {
	DPIHandler.DPIStageUpdated(3);
}
export function ondpi4Changed() {
	DPIHandler.DPIStageUpdated(4);
}

export function ondpi5Changed() {
	DPIHandler.DPIStageUpdated(5);
}

export function ondpi6Changed() {
	DPIHandler.DPIStageUpdated(6);
}

export function onPollRateChanged() {
	// Schreibt die Normal-Modus-Rate nur wenn wir gerade NICHT im Game
	// Mode sind. Im GM ist die GM-Rate aktiv — die Normal-Rate wird beim
	// nächsten Verlassen von Game Mode automatisch übernommen (siehe
	// setHardwareGameMode).
	if(settingControl && !gameModeActive) {
		setPollRate(PollRate);
	} else if (settingControl && gameModeActive) {
		device.log(`Polling Rate (Normal) changed to [${PollRate}] but currently in Game Mode — wird beim Verlassen von Game Mode aktiv.`);
	}
}

export function ongameModePollRateChanged() {
	// Schreibt die Game-Mode-Rate nur wenn wir gerade IM Game Mode sind.
	// Außerhalb wird's beim nächsten Aktivieren von Game Mode automatisch
	// übernommen.
	if(settingControl && gameModeActive) {
		setPollRate(gameModePollRate);
	} else if (settingControl && !gameModeActive) {
		device.log(`Polling Rate (Game Mode) changed to [${gameModePollRate}] but Game Mode is OFF — wird beim Aktivieren von Game Mode aktiv.`);
	}
}

/** @type {CorsairBragiDongle | undefined} */
let BragiDongle;
/** @type {CorsairBragiDevice | undefined} */
let wiredDevice;
// Dark core Pro SE wired firmware 5.0.41
// wireless firmware 5.6.126

/** @type {Options} */
const options = {
	developmentFirmwareVersion: "5.6.126",
};

/** @param {HidEndpoint} endpoint */
export function Validate(endpoint) {
	// Vanguard Pro 96
	return (endpoint.interface === 2 && endpoint.usage === 0x0001 && endpoint.usage_page === 0xFF42) ||
	(endpoint.interface === 3 && endpoint.usage === 0x0002 && endpoint.usage_page === 0xFF42);
}

export function Initialize() {
	device.set_endpoint(0x03, 0x02, 0xFF42);

	device.write([0x00, 0x00, 0x01, 0x00, 0x1b, 0x01, 0x14, 0x64, 0x35, 0x52], 1024);
	device.set_endpoint(0x02, 0x01, 0xFF42);

	sendAndRead([0x00, 0x00, 0x01, 0x00, 0x1b, 0x01, 0x3d, 0x78, 0xaf, 0x8b]);
	sendAndRead([0x00, 0x00, 0x01, 0x00, 0x1b, 0x01, 0xcf, 0xde, 0x51, 0x08]);
	sendAndRead([0x00, 0x00, 0x01, 0x02, 0x1b, 0x02, 0x00, 0x00, 0x00, 0x00, 0x02]);
	sendAndRead([0x00, 0x00, 0x01, 0x00, 0x1b, 0x01, 0xbf, 0xe4, 0x19, 0x3a]);
	sendAndRead([0x00, 0x00, 0x01, 0x02, 0x01, 0x03, 0x00, 0x02]);

	Corsair.SetMode("Software", 1);
	Corsair.FetchDeviceInformation();
	fetchAndConfigureChildren();

	// ✅ Callback wird VOR refreshKeyboardLighting() registriert
	device.log("Registering macro input callback...");
	macroInputArray.setCallback((bitIdx, isPressed) => { return processMacroInputs(bitIdx, isPressed); });
	device.log("Macro input callback registered successfully.");

	// Aktuellen Hardware-State von der Tastatur lesen, damit unser Plugin
	// synchron ist falls Game Mode / FlashTap schon physisch eingeschaltet
	// wurden bevor SignalRGB lief. Property-IDs aus init_with_gamemode_on/off
	// captures: 0xE1 = Game Mode, 0x0100 = FlashTap. FetchProperty gibt
	// 0/1 zurück oder -1 bei Fehler.
	try {
		const gmState = Corsair.FetchProperty(0xE1, 1);
		if (gmState === 0 || gmState === 1) {
			gameModeActive = (gmState === 1);
			device.log(`Detected initial Game Mode state: ${gameModeActive ? "ON" : "OFF"}`);
		}
	} catch (e) { device.log(`Game Mode state detection failed: ${e}`); }
	try {
		const ftState = Corsair.FetchProperty(0x0100, 1);
		if (ftState === 0 || ftState === 1) {
			flashTapActive = (ftState === 1);
			device.log(`Detected initial FlashTap state: ${flashTapActive ? "ON" : "OFF"}`);
		}
	} catch (e) { device.log(`FlashTap state detection failed: ${e}`); }

	if (gameMode) setHardwareGameMode(gameMode);
	if (flashTap) setHardwareFlashTap(flashTap);

	// Knob auf definierten Start-State: enabled[0] = Volume (siehe
	// getEnabledKnobModes — Volume ist hardcoded immer aktiv und steht in
	// KNOB_MODES an Position 0). Ohne diesen Write bliebe der Knob auf
	// was-auch-immer-er-vorher-war (iCUE-Setting, vorherige Session, etc.).
	knobModeIdx = 0;
	writeKnobMode(getEnabledKnobModes()[0]);

	refreshKeyboardLighting();
}

function sendAndRead(packet) {
	device.write(packet, 1024);

	device.read([0x00], 1024);
}

let subdevicesEditedLastFrame = false;
let _lastGameModeSyncAt = 0;
const GAME_MODE_SYNC_INTERVAL_MS = 3000;

export function Render() {
	// Polling-Rate-Wechsel löst USB-Re-Enumeration aus (~5s). In dieser
	// Zeit ist der device-Handle in unsicherem Zustand — wir bailen aus
	// dem Render-Loop bis die Grace-Period abgelaufen ist, sonst crasht
	// SignalRGB auf einem toten Handle.
    if (Date.now() < pollRateRebootUntil) {
        return;
    }

	readDeviceNotifications();

	if(subdevicesEditedLastFrame) {
		subdevicesEditedLastFrame = false;

		return;
	}

	if(wiredDevice){
		// Detect external Game Mode toggles (third-party tool writing
		// setProperty(0xE1) directly). Rate-limited because FetchProperty
		// does a USB roundtrip — running it every frame would tank the
		// render budget.
		const now = Date.now();
		if (now - _lastGameModeSyncAt >= GAME_MODE_SYNC_INTERVAL_MS) {
			_lastGameModeSyncAt = now;
			syncGameModeFromHardware();
		}

		PollDeviceMode();
		PollDeviceState();
		UpdateRGB(wiredDevice);
	}
}

// Bragi-v2 Hardware-Mode-Switch für Vanguard 96 / Vanguard Pro 96.
// Captured aus dumps/corsair_keyboard/back_to_hardware_modus.pcapng:
//   Frame 7: setProperty(mode=0x03, value=0x01 Hardware) auf conn=0x03
//   Frame 11: Session-Reset `0x1B 02 ... 03` auf conn=0x03
// Das legacy Corsair.SetMode("Hardware") (deviceID|0x08) hat auf der v2-
// Firmware der Vanguard-Familie keine Wirkung — die Tastatur bleibt im
// Software-Mode hängen, was Fn+F12 / Drehknopf etc. auch nach Plugin-
// Disable kaputt lässt.
function switchToHardwareModeV2() {
    // sendAndRead statt device.write — iCUE wartet zwischen den beiden
    // Paketen auf den Firmware-ACK (siehe back_to_hardware_modus.pcapng
    // frame 7 → response → frame 11). Ohne ACK-Wait kommt der zweite
    // Write zu früh und die Firmware verwirft den Session-Reset.
    sendAndRead([0x00, 0x00, 0x01, 0x03, 0x01, 0x03, 0x00, 0x01]);
    sendAndRead([0x00, 0x00, 0x01, 0x03, 0x1b, 0x02, 0x00, 0x00, 0x00, 0x00, 0x03]);
    device.log("Switched to Hardware mode via v2 protocol (conn=0x03)");
}

export function Shutdown(SystemSuspending) {
	device.log(`Shutdown called (SystemSuspending=${SystemSuspending})`);
	if(SystemSuspending){
		// Go Dark on System Sleep/Shutdown
		if(wiredDevice) {
			UpdateRGB(wiredDevice, undefined, "#000000");
			switchToHardwareModeV2();
			// Legacy Corsair.SetMode("Hardware") absichtlich NICHT mehr für
			// wiredDevice — der nutzt deviceID|0x08 (byte2=0x09) was die
			// v2-Firmware nicht versteht und unseren Switch kippen kann.
		}

		if(BragiDongle){
			for(const [key, value] of BragiDongle.children){
				UpdateRGB(value, key, "#000000");
				Corsair.SetMode("Hardware", key);
			}
		}
	}else{
		if(wiredDevice) {
			UpdateRGB(wiredDevice, undefined, shutdownColor);
			switchToHardwareModeV2();
		}

		if(BragiDongle){
			for(const [key, value] of BragiDongle.children){
				UpdateRGB(value, key, shutdownColor);
				Corsair.SetMode("Hardware", key);
			}
		}
	}
}

function setMacroKeys(deviceID = 1, keyCount = 0) {
	const macroFill = new Array(keyCount).fill(1);
	device.log(`Macrofill Key Count ${keyCount}`);

	device.log("Doing things to keys");
	Corsair.WriteToEndpoint(1, Corsair.endpoints.Buttons, macroFill, deviceID);
}


// Known wired keyboards in this fork. The upstream Bragi codebase tries to
// detect device class by probing properties (wireless subdevice bitmask,
// battery level, DPI), and each failing probe writes a generic "Property
// is not supported on this device!" line to the log. These PIDs are wired
// keyboards with no battery, no DPI, no wireless dongle — so we short-
// circuit before issuing the probes that we know will fail.
const WIRED_KEYBOARD_PIDS = new Set([0x2B0D, 0x2B0E]);

function _knownWiredKeyboard() {
	try {
		const pid = device.productId();
		return WIRED_KEYBOARD_PIDS.has(pid);
	} catch (_) {
		return false;
	}
}

function fetchAndConfigureChildren() {
	// Skip the wireless-subdevice probe for known wired keyboards — there
	// will never be a dongle here, the FetchProperty(0x36) call just fails
	// and logs noise.
	if (_knownWiredKeyboard()) {
		device.log("Wired keyboard detected (skipping wireless probe). Setting up Wired Mode...", {toFile: true});
		setupWiredDevice();
		return;
	}

	if(Corsair.IsPropertySupported(Corsair.properties.subdeviceBitmask)){
		device.log(`Wireless Dongle detected!`, {toFile : true});

		if(!BragiDongle){
			BragiDongle = new CorsairBragiDongle();
		}

		setupDongle();

		return;
	}

	device.log("Device is not a wireless dongle. Setting up Wired Mode...", {toFile : true});
	setupWiredDevice();

}

function setupDongle() {
	const children = GetConnectedSubdevices();

	device.log(`Detected ${children.length} connected device(s)!`);


	for(let devices = 0; devices < children.length; devices++) {
		device.log("Child BitID: " + children[devices]);

		if(devices > 1 && !devFlags){
			device.notify("Multipoint is not supported!", "Multipoint is not supported on Corsair devices due to instability issues. Please pair devices to their respective dongles.", 1);
			device.log(`Multiple Devices Connected. Plugin Doesn't support this!`);

			return;
		}

		if(devFlags) {
			addChildDevice(children[devices]);
		} else { addSinglePointChild(children[devices]); }

	}
}

function setupWiredDevice() {
	const devicePID = Corsair.FetchProperty(Corsair.properties.pid);
	const deviceConfig = CorsairLibrary.GetDeviceByProductId(devicePID);

	wiredDevice = new CorsairBragiDevice(deviceConfig, 0x00);

	if(!devFlags) {
		device.setName(wiredDevice.name);
		device.setSize(wiredDevice.size);
		device.setControllableLeds(wiredDevice.ledNames, wiredDevice.ledPositions);
		device.setImageFromUrl(wiredDevice.image);
		initializeDevice(wiredDevice);
	}

	if(devFlags) { createSubdevice(wiredDevice); initializeDevice(wiredDevice); }
}

/* eslint-disable complexity */
function initializeDevice(deviceConfig, deviceID = 1) {
	Corsair.SetMode("Software", deviceID);

	const devicePID = Corsair.FetchProperty(Corsair.properties.pid);

	if(devicePID === 0x1BAB) {
		Corsair.SetHWBrightness(999, deviceID); //K100 Air reports 100% brightness even when not at 100% on Dev FW Version: 5.6.126.
	} else {
		Corsair.SetHWBrightness(1000, deviceID);
	}

	deviceConfig.isLightingController = Corsair.FetchLightingControllerSupport(deviceID);
	device.log(`Device Uses Lighting Controller Scheme: ${deviceConfig.isLightingController}`);
	device.log("Let There Be Light!");

	deviceConfig.supportsBattery = Corsair.FetchBatterySupport(deviceID);
	device.log(`Device Battery Support: ${deviceConfig.supportsBattery}`);

	if(deviceConfig.supportsBattery) {
		device.addFeature("battery");

		const [BatteryLevel, ChargeState] = Corsair.FetchBatteryStatus(deviceID);

		device.log(`Battery Level is [${(BatteryLevel ?? 0)/10}%]`);
		device.log(`Battery Status is [${Corsair.chargingStates[ChargeState ?? 0]}]`);

		battery.setBatteryLevel((BatteryLevel ?? 0)/ 10);
		battery.setBatteryState(Corsair.chargingStateDictionary[ChargeState ?? 0]);
	}

	if(deviceConfig.keymapType === "Mouse") {
		device.addFeature("mouse");
		configureMouseButtons(deviceID);
	} else if(deviceConfig.keymapType === "Keyboard") {
		if([0x1B7D, 0x1BC5, 0x1B7C].includes(devicePID)) { setMacroKeys(deviceID, deviceConfig.keyCount); }
		//Some devices break if we specify the macro keys and others need it.
		//This one is specifically for the K100.

		device.addFeature("keyboard");
	}

	device.pause(5);

	if(Corsair.FetchDPISupport(deviceID)) {

		addPollingRates(deviceID, true);

		if(deviceConfig.hasSniperButton) {
			DPIHandler.addSniperProperty();
		}

		DPIHandler.setMinDpi(200);
		DPIHandler.setMaxDpi(deviceConfig.maxDPI?? 15000);
		DPIHandler.setUpdateCallback((dpi) => { return Corsair.SetDPI(dpi, deviceID); });
		DPIHandler.addProperties();
		DPIHandler.setRollover(dpiRollover);

		if(settingControl) {
			DPIHandler.setActiveControl(settingControl);
			DPIHandler.update();
		}
	} else {
		addPollingRates(deviceID);
	}
}
/* eslint-enable complexity */

function GetConnectedSubdevices(){
	device.log(`Checking for connected devices!`);

	const bitmask = Corsair.FetchProperty(Corsair.properties.subdeviceBitmask);
	device.log("Bitmask:" + bitmask);

	const ConnectedChildren = [];

	for(let i = 1; i < 8; i ++){
		const mask = 1 << i;

		if(bitmask & mask){
			ConnectedChildren.push(i);
		}
	}

	return ConnectedChildren;
}

function createSubdevice(subdevice) {
	device.createSubdevice(subdevice.name);
	device.setSubdeviceName(subdevice.name, `${subdevice.name}`);
	//TODO: Attach image url to device library
	//device.setSubdeviceImage(subdevice.name, Image()); //can't wait to have a dict for these
	device.setSubdeviceSize(subdevice.name, subdevice.size[0], subdevice.size[1]);
	device.setSubdeviceLeds(subdevice.name,
		subdevice.ledNames,
		subdevice.ledPositions);
}

function readDeviceNotifications(){
	device.set_endpoint(0x03, 0x02, 0xFF42);

	do{
		const data = device.read([0x00], Corsair.config.ReadLength, 0); // Read Key Event

		if(device.getLastReadSize() === 0){
			break;
		}

		ProcessInput(data);

	}while(device.getLastReadSize() > 0);

	device.set_endpoint(0x02, 0x01, 0xFF42);
}

let macroSubdeviceID = 0;

//Possibly make a bragi notification struct?
function ProcessInput(InputData){
	// Notification
	if(InputData[4] === 1){

		const subdeviceId = InputData[3];
		const NotificationType = BinaryUtils.ReadInt16LittleEndian(InputData.slice(5, 7));
		const value = BinaryUtils.ReadInt32LittleEndian(InputData.slice(7, 11));

		switch(NotificationType){
		case Corsair.properties.batteryLevel:
			setDeviceBatteryLevel(subdeviceId, value);
			break;
		case Corsair.properties.batteryStatus:
			setDeviceBatteryState(subdeviceId, value);
			break;

		case(Corsair.properties.subdeviceBitmask): {
			device.log(`Subdevice: [${subdeviceId}], Subdevice Notification. Value is [${value}]`);

			if(subdeviceId === 0) {
				addAndRemoveDevicesFromDongleNotifications(value);
				subdevicesEditedLastFrame = true;
			} //If it isn't subdevice 0 it isn't coming from the dongle.

			break;
		}

		default:
			device.log(`Subdevice: [${subdeviceId}], Unknown Notification: [${NotificationType}]. Value is [${value}]`);
		}
	}

	if(InputData[4] === 2){
		macroSubdeviceID = InputData[3]; //Doesn't persist through the macroInputArray, so I save to a global var.
		// I doubt we'll ever have over 32 bytes (256 Keys) of bit flags.
		macroInputArray.update(InputData.slice(5, 37));
	}

	if(InputData[4] === 5) {
		// Rotary-Notification vom Vanguard Pro 96:
		// `00 00 00 05 60 00 <delta-LE32>` auf interface 3 (notification ep).
		// InputData ist um 1 vorgeschoben → byte 5 = 0x60 (Wheel-Button-ID),
		// byte 6 = 0x00 (padding), bytes 7-10 = signed LE32 Delta.
		// `0x01000000` = +1 (rechts), `0xffffffff` = -1 (links).
		// Welche Aktion bei +/- gefeuert wird steht im KNOB_MODE — wird
		// via Fn+F12 gecycled (cycleFnMode).
		const delta = BinaryUtils.ReadInt32LittleEndian(InputData.slice(7, 11));
		const mode = getKnobMode();
		if (mode.action) {
			mode.action(delta);
		}
	}
}
//1, 2, 4, 8
//02, 06, 14, 15

let winLockEnabled = false;

// WinLock-Toggle via Bragi-v2 setProperty. Die Vanguard Pro 96 trennt
// „normales WinLock" und „WinLock im Game Mode" auf zwei separate
// Properties + Connections (captured byte-genau):
//   propID=0x45 auf conn=0x03 = WinLock wenn Game Mode AUS
//       (FNWIN_disable_win_key.pcapng frames 21 ON / 145 OFF)
//   propID=0xEB auf conn=0x02 = WinLock wenn Game Mode AN
//       (FNWIN_disable_win_key_ingamemode.pcapng frames 21 ON / 53 OFF)
// Die Firmware verwaltet die zwei Slots unabhängig — und der wirksame
// Slot wechselt wenn Game Mode toggled wird. Um Inkonsistenzen zu
// vermeiden schreiben wir bei jedem Toggle BEIDE Slots auf den gleichen
// Wert. Dann ist der WinLock-State Game-Mode-unabhängig konsistent.
// Legacy Corsair.SetProperty() greift auf der v2-Firmware nicht.
function setWinLock(enabled) {
	winLockEnabled = !!enabled;
	const val = winLockEnabled ? 0x01 : 0x00;
	// Slot 1: GM-AUS-WinLock (propID 0x45 auf conn=0x03)
	device.write([0x00, 0x00, 0x01, 0x03, 0x01, 0x45, 0x00, val], 1024);
	// Slot 2: GM-AN-WinLock (propID 0xEB auf conn=0x02)
	device.write([0x00, 0x00, 0x01, 0x02, 0x01, 0xEB, 0x00, val], 1024);
	device.log(`WinLock ${winLockEnabled ? "engaged" : "released"} (both slots written: 0x45@conn=0x03 + 0xEB@conn=0x02)`);
}

/* eslint-disable complexity */
function processFnKeys(key, isPressed) {
    //This is going to snowball HARD.
    //We have to be careful about how we try and maintain this.
    //I may break it out into its own class, and add library entries for things like the winlock light, and different keymaps.
    //This most likely is going to end up like Logitech does with a button map lib.
    // Fn-Media-Layer auf dem Vanguard Pro 96 (gemäß Tastenbeschriftung):
    //   F6 = |◀ Skip Back, F7 = ▶|| Play/Pause, F8 = ▶| Skip Forward
    //   F9 = Mute, F10 = Vol Down, F11 = Vol Up, F12 = Fn-Mode-Cycle
    //   Fn + Left Win = WinLock toggle, Lock-Taste = WinLock toggle
    // Rückgabewert: true wenn das Event von uns konsumiert wurde — dann
    // muss processKeyboardMacros das Event NICHT an Windows weiterleiten
    // (sonst öffnet z.B. Fn+Win das Start-Menü trotz WinLock-Toggle).
    // F1–F5 sind nicht eindeutig belegt — kein sendHid, kein consume.
    switch(key) {

    case "F6":
        device.log("Skip Backward");
        keyboard.sendHid(0xB1, {released: !isPressed});
        return true;

    case "F7":
        device.log("Play/Pause");
        keyboard.sendHid(0xB3, {released: !isPressed});
        return true;

    case "F8":
        device.log("Skip Forward");
        keyboard.sendHid(0xB0, {released: !isPressed});
        return true;

    case "F9":
        device.log("Mute");
        keyboard.sendHid(0xAD, {released: !isPressed});
        return true;

    case "F10":
        device.log("Volume Down");
        keyboard.sendHid(0xAE, {released: !isPressed});
        return true;

    case "F11":
        device.log("Volume Up");
        keyboard.sendHid(0xAF, {released: !isPressed});
        return true;

    case "F12":
        if(isPressed) {
            cycleFnMode();
        }
        return true;

    case "Left Win":
        // Fn + Linke Windows-Taste = WinLock toggle. Bytes captured in
        // dumps/corsair_keyboard/FNWIN_disable_win_key.pcapng (frame 21
        // ON, frame 145 OFF) — setProperty(0x45, value) on conn=0x03.
        if(isPressed) {
            setWinLock(!winLockEnabled);
            refreshKeyboardLighting();
        }
        return true;

    case "Lock":
        if(isPressed) {
            setWinLock(!winLockEnabled);
            refreshKeyboardLighting();
        }
        return true;
    }
    return false;
}
/* eslint-enable complexity */

let FnEnabled = false;

function processMacroInputs(bitIdx, state) {
    device.set_endpoint(0x02, 0x01, 0xFF42);

    let deviceType;
    let buttonMapType;

    // ✅ Wenn macroSubdeviceID === 0 ODER wir haben kein BragiDongle, nutze wiredDevice
    if(macroSubdeviceID === 0 || !BragiDongle) {
        if (!wiredDevice) {
            device.log(`[processMacroInputs] wiredDevice is undefined (not yet initialized). Skipping macro processing.`);
            return;
        }
        deviceType = wiredDevice.keymapType;
        buttonMapType = wiredDevice.buttonMap;
    } else {
        const subdevice = BragiDongle.children.get(macroSubdeviceID);
        if (!subdevice) {
            device.log(`[processMacroInputs] Subdevice ${macroSubdeviceID} not found in BragiDongle. Skipping macro processing.`);
            return;
        }
        deviceType = subdevice.keymapType;
        buttonMapType = subdevice.buttonMap;
    }

    const keyName = CorsairLibrary.GetKeyMapping(bitIdx, deviceType, buttonMapType);

    if(keyName !== undefined) {
        if(deviceType === "Keyboard") {
            processKeyboardMacros(bitIdx, state, keyName);
        } else if(deviceType === "Mouse") {
            processMouseMacros(bitIdx, state, keyName);
        }
    }
}

function processMouseMacros(bitIdx, state, keyName) {
	if(state) {
		switch(keyName) {
		case "Forward":
			keyboard.sendHid(0x05, {released : false});
			break;
		case "Back":
			keyboard.sendHid(0x06, {released : false});
			break;
		case "Dpi Stage Up":
			DPIHandler.increment();
			break;
		case "Dpi Stage Down":
			DPIHandler.decrement();
			break;
		case "Sniper":
			DPIHandler.setSniperMode(true);
			break;
		default:
			const eventData = {
				"buttonCode": 0,
				"released": !state,
				"name":keyName
			};
			device.log(`Key ${keyName}[${bitIdx}] is state ${state}`);
			mouse.sendEvent(eventData, "Button Press");
		}
	} else {
		switch(keyName) {
		case "Forward":
			keyboard.sendHid(0x05, {released : true});
			break;
		case "Back":
			keyboard.sendHid(0x06, {released : true});
			break;
		case "Sniper":
			DPIHandler.setSniperMode(false);
			break;
		default:
			const eventData = {
				"buttonCode": 0,
				"released": !state,
				"name":keyName
			};
			mouse.sendEvent(eventData, "Button Press");
		}
	}
}

function processKeyboardMacros(bitIdx, state, keyName) {
	const eventData = {
		key : keyName,
		keyCode : 0,
		"released": !state,
	};


	if(keyName === "Fn") {
		FnEnabled = state;
	}

	// Wenn ein Fn-Layer-Key (F6-F12, Left Win, Lock) gedrückt wird,
	// konsumiert processFnKeys das Event und gibt true zurück. In dem Fall
	// leiten wir das Event NICHT an Windows weiter — sonst kommt die rohe
	// F-Taste / Win-Taste durch und Start-Menü öffnet sich beim WinLock-
	// Toggle, F-Tasten triggern „Skip Backward"-artige Fehlinterpretationen.
	let consumed = false;
	if(FnEnabled) {
		consumed = processFnKeys(eventData.key, state) === true;
	}

	// The physical Game Mode key fires bitIdx 130 (= "Game Mode") but the
	// firmware does NOT engage Game Mode itself — it just emits the event
	// and waits for the host to echo `setProperty(0xE1)`. iCUE does this in
	// game_mode_on_off.pcapng frame 9. We do the same here, on key DOWN
	// only, so a single press toggles between engaged and released.
	if(keyName === "Game Mode" && state) {
		const newState = !gameModeActive;
		setHardwareGameMode(newState);
		consumed = true;
	}

	// Fn + Right Shift toggles FlashTap (SOCD). Same pattern: the keyboard
	// emits a Right-Shift-down event while Fn is held but waits for the
	// host to echo `setProperty(0x0001)` on conn=0x03 to actually engage
	// the feature. Reference: flashtap_on_then_off.pcapng frames 23 / 25.
	if(keyName === "Right Shift" && state && FnEnabled) {
		const newState = !flashTapActive;

		setHardwareFlashTap(newState);
		consumed = true;
	}

	// Knob-Klick (Wheel Key, bitIdx 137) → modus-abhängige Aktion. iCUE
	// fired Play/Pause im Media-Modus, Mute im Volume-Modus. Nur auf
	// press (state=true) reagieren, sonst kommt der Event doppelt.
	if(keyName === "Wheel Key" && state) {
		const mode = getKnobMode();
		if (mode.pushAction) {
			mode.pushAction();
		}
		consumed = true;
	}

	device.log(`Key ${keyName} is state ${state}${consumed ? " (consumed)" : ""}`);
	if (!consumed) {
		keyboard.sendEvent(eventData, "Key Press");
	}
}

function configureMouseButtons(deviceID) { //TODO: Rewrite this properly once I get user confirmation of functionality.
	device.log("Made buttons do button things again!");
	Corsair.SetKeyStates(0x01, 5, deviceID);
	device.log(Corsair.ReadFromEndpoint(1, Corsair.endpoints.Buttons, deviceID));
}

function addSinglePointChild(subdeviceID) {
	let devicePID = Corsair.FetchProperty(Corsair.properties.pid, subdeviceID);
	device.log(`Device PID: ${devicePID.toString(16)}`);

	let retries = 0;

	while(devicePID === -1 && retries < 5) {
		device.log("Resetting Dongle");
		Corsair.ResetDongle();
		devicePID = Corsair.FetchProperty(Corsair.properties.pid, subdeviceID);
		retries++;

		if(retries === 5) {
			device.log(`Subdevice ID ${subdeviceID} failed after 5 resets.`, {toFile : true});

			break; //break the loop. Don't init a bad device.
		}
	}

	const deviceConfig = CorsairLibrary.GetDeviceByProductId(devicePID);

	const connectedDevice = new CorsairBragiDevice(deviceConfig, subdeviceID);

	if(deviceConfig && deviceConfig.name) {
		DeviceDiscovery.foundVirtualDevice({
			type: deviceConfig.type || "other",
			name: deviceConfig.name,
			supported: true,
			vendorId: 0x1b1c,
			productId: devicePID
		});
	}

	if(BragiDongle) {
		BragiDongle.addChildDevice(connectedDevice.subdeviceId, connectedDevice, false);
		device.setName(connectedDevice.name);
		device.setSize(connectedDevice.size);
		device.setControllableLeds(connectedDevice.ledNames, connectedDevice.ledPositions);
		device.setImageFromUrl(connectedDevice.image);
		initializeDevice(connectedDevice, connectedDevice.subdeviceId);
	} else {
		device.log(`Bragi Dongle is not defined! Throwing error`, {toFile : true});
	}
}

function addChildDevice(subdeviceID) {
	let devicePID = Corsair.FetchProperty(Corsair.properties.pid, subdeviceID);
	device.log(`Device PID: ${devicePID.toString(16)}`);

	let retries = 0;

	while(devicePID === -1 && retries < 5) {
		device.log("Resetting Dongle");
		Corsair.ResetDongle();
		devicePID = Corsair.FetchProperty(Corsair.properties.pid, subdeviceID);
		retries++;

		if(retries === 5) {
			device.log(`Subdevice ID ${subdeviceID} failed after 5 resets.`, {toFile : true});

			break; //break the loop. Don't init a bad device.
		}
	}

	const deviceConfig = CorsairLibrary.GetDeviceByProductId(devicePID);

	const connectedDevice = new CorsairBragiDevice(deviceConfig, subdeviceID);

	if(deviceConfig && deviceConfig.name) {
		DeviceDiscovery.foundVirtualDevice({
			type: deviceConfig.type || "other",
			name: deviceConfig.name,
			supported: true,
			vendorId: 0x1b1c,
			productId: devicePID
		});
	}

	if(BragiDongle) {
		BragiDongle.addChildDevice(connectedDevice.subdeviceId, connectedDevice);
		initializeDevice(connectedDevice, connectedDevice.subdeviceId);
	} else {
		device.log(`Bragi Dongle is not defined! Throwing error`, {toFile : true});
	}

}

function addAndRemoveDevicesFromDongleNotifications(bitmask) {
	device.set_endpoint(0x02, 0x01, 0xFF42);

	const ConnectedChildren = [];

	for(let i = 1; i < 8; i ++){
		const mask = 1 << i;

		if(bitmask & mask){
			ConnectedChildren.push(i);
		}
	}

	const mapChildren = Array.from(BragiDongle.children.keys());

	const childrenToAdd = ConnectedChildren.filter(x => !mapChildren.includes(x));
	const childrenToRemove = mapChildren.filter(x => !ConnectedChildren.includes(x));

	for(const child of childrenToRemove) {
		device.log(`Removing Child Device ${child}`);
		BragiDongle.removeChildDevice(child);
	}

	if(ConnectedChildren.length === 0) {
		device.setImageFromUrl("https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png");
		device.removeProperty("settingControl");
		device.removeProperty("PollRate");
		DPIHandler.removeProperties();
	}

	for(const child of childrenToAdd) {
		device.log(`Adding Child Device ${child}`);

		if(mapChildren.length === 0 && !devFlags) { //All of this will be cleaned up when we deprecate and remove devflags.
			addSinglePointChild(child);
		} else if(devFlags) {
			addChildDevice(child);
		}
	}
}

function setDeviceBatteryLevel(subdeviceId, value) {
	if(wiredDevice) {
		wiredDevice.batteryPercentage = value / 10;

		return;
	}

	const subdevice = BragiDongle ? BragiDongle.children.get(subdeviceId) : undefined;

	if(!subdevice){
		console.log("Por que dongle?");

		return;
	}

	subdevice.batteryPercentage = value / 10;

	device.log(`Subdevice: [${subdeviceId}], Battery Level is [${value / 10}]`); //We'll need a handler to split these by subdeviceID. For now that isn't an issue per se.
	battery.setBatteryLevel(value / 10);
}

function setDeviceBatteryState(subdeviceId, value) {
	if(wiredDevice) {
		wiredDevice.batteryPercentage = value / 10;

		return;
	}

	const subdevice = BragiDongle ? BragiDongle.children.get(subdeviceId) : undefined;

	if(!subdevice){
		console.log("Por que dongle?");

		return;
	}

	subdevice.batteryPercentage = value / 10;

	device.log(`Subdevice: [${subdeviceId}], Battery Status is [${Corsair.chargingStates[value]}]`);
	battery.setBatteryState(Corsair.chargingStateDictionary[value]);
}

function PollDeviceMode(deviceID = 1){
	const PollInterval = 5000;

	if(Date.now() - PollDeviceMode.lastPollTime < PollInterval) {
		return;
	}

	//K100 Air Hates devices disconnecting from the dongle, and hates reconnecting to the dongle.
	// Either the dongle or the K100 Air falls into an errored state. It seems to be the dongle.
	//To fix the error, we reset the dongle, which makes the dongle d/c every device and it resends subdevice notifications.
	//We drop everything and pick it all back up when that happens.
	if(BragiDongle) {
		for(const [key, value] of BragiDongle.children) {
			if(!Corsair.SetMode("Software", key)) {
				Corsair.ResetDongle();
			}
		}
	}

	if(wiredDevice) {
		Corsair.SetMode("Software", deviceID);
	}


	PollDeviceMode.lastPollTime = Date.now();
}


function PollDeviceState(deviceID = 1){
	// Corsair Pings every 52 Seconds. This will keep the device in software mode.
	const PollInterval = 50000;

	if(Date.now() - PollDeviceState.lastPollTime < PollInterval) {
		return;
	}

	if(Corsair.PingDevice(deviceID)){
		device.log(`Device Ping Successful!`);
	}else{
		device.log(`Device Ping Failed!`);
	}

	PollDeviceState.lastPollTime = Date.now();
}

function addPollingRates(deviceId, isMouse = false) {
    const currentPollingRate = Corsair.FetchProperty(Corsair.properties.pollingRate, deviceId);
    let maxPollingRate = Corsair.FetchProperty(Corsair.properties.maxPollingRate, deviceId);

    if(maxPollingRate === -1){
        maxPollingRate = Corsair.pollingRateNames["1000hz"];
    }

    const pollingRateValues = [];

    for(let pollingRateValueCount = 1; pollingRateValueCount < maxPollingRate + 1; pollingRateValueCount++) {
        pollingRateValues.push(Corsair.pollingRates[pollingRateValueCount]);
    }

    let defaultRate = "1000hz";

    if(currentPollingRate > 0 && Corsair.pollingRates[currentPollingRate]) {
        defaultRate = Corsair.pollingRates[currentPollingRate];
    } else if (typeof PollRate === "string" && pollingRateValues.includes(PollRate)) {
        defaultRate = PollRate;
    }

    device.addProperty({ "property": "settingControl", "group": isMouse ? "mouse" : "", "label": "Enable Setting Control", description: "Required for SignalRGB to actually push DPI / Polling Rate changes to the keyboard. Off by default to avoid surprising firmware writes; turn on once you've decided you want SignalRGB managing those values.", "type": "boolean", "default": "false", "order": 1 });
    device.addProperty({"property": "PollRate", "group": isMouse ? "mouse" : "", "label": "Polling Rate (Normal)", description: "Polling rate used when Game Mode is OFF. Each rate change reboots the keyboard (~5s). Only applied while Enable Setting Control is on.", "type": "combobox", "values": pollingRateValues, "default": defaultRate });
    device.addProperty({"property": "gameModePollRate", "group": isMouse ? "mouse" : "", "label": "Polling Rate (Game Mode)", description: "Polling rate used while Game Mode is ON. Auto-switched when Game Mode toggles. Set the same as the normal rate to avoid USB re-enumeration on every Game Mode toggle.", "type": "combobox", "values": pollingRateValues, "default": defaultRate });

    // Initial-State: was die Tastatur gerade tatsächlich fährt. Verhindert
    // dass wir bei Plugin-Reload sofort unnötig einen Reboot triggern, nur
    // weil _lastWrittenPollRate sonst undefined wäre.
    if (currentPollingRate > 0 && Corsair.pollingRates[currentPollingRate]) {
        _lastWrittenPollRate = Corsair.pollingRates[currentPollingRate];
    }
}

// Wann der letzte Polling-Rate-Write den USB-Reboot ausgelöst hat. Render
// hält für die Dauer dieses Grace-Periods die Klappe, damit es nicht in
// einen toten device-Handle schreibt und SignalRGB crasht.
let pollRateRebootUntil = 0;
const POLL_RATE_REBOOT_GRACE_MS = 6000;

// Letzter Rate-Wert den wir aktiv auf die Tastatur geschrieben haben.
// Wird bei Init aus FetchProperty (currentPollingRate in addPollingRates)
// vorbelegt. Nutzen wir um redundante Writes zu vermeiden — jeder Write
// löst eine ~5s USB-Re-Enumeration aus.
let _lastWrittenPollRate = null;

function setPollRate(pollRate, deviceID = 1) {
    const pollingRateId = Corsair.pollingRateNames[pollRate];

    if (pollingRateId === undefined) {
        device.log(`Unknown polling rate label [${pollRate}]; ignoring.`);
        return;
    }

    if (pollRate === _lastWrittenPollRate) {
        device.log(`Polling Rate already at [${pollRate}] — skip write to avoid unnecessary reboot.`);
        return;
    }

    // Bragi-v2 setProperty(0x01 = pollingRate) on conn=0x02. Die Vanguard
    // Pro 96 nimmt die Änderung nur im Game Mode an (außerhalb wird das
    // Paket still verworfen). Sobald greift, rebootet sie ~5s lang per
    // USB-Re-Enumeration — Render muss in der Zeit pausieren sonst
    // crasht SignalRGB auf einem toten Device-Handle.
    device.log(`Setting Polling Rate to [${pollRate}, id=${pollingRateId}] — entering ${POLL_RATE_REBOOT_GRACE_MS}ms grace period`);
    pollRateRebootUntil = Date.now() + POLL_RATE_REBOOT_GRACE_MS;
    _lastWrittenPollRate = pollRate;
    try {
        device.write([0x00, 0x00, 0x01, 0x02, 0x01, 0x01, 0x00, pollingRateId & 0xFF], 1024);
    } catch (e) {
        device.log(`setPollRate write threw: ${e}`);
    }
}

function UpdateRGB(childDevice, deviceID, overrideColor){
	const isLightingController = childDevice.isLightingController;
	//Using this to force a read back on streaming ops. Other Bragi devices may work fine with it, but I have no way to check that across the board.
	//For now, I'm going to only apply it to devices that are known to REQUIRE it.
	const requiresStreamingRead = (childDevice.name === "K70 Core" || childDevice.name === "K60 Pro" );
	const RGBData = getColors(childDevice, overrideColor, isLightingController);

	if(RGBData){
		Corsair.SendRGBData(RGBData, deviceID, isLightingController, requiresStreamingRead);
	}
}

function getColors(childDevice, overrideColor, isLightingController) {
	if(isLightingController) {
		return getLightingControllerColors(childDevice, overrideColor, devFlags);
	}

	return getStandardColors(childDevice, overrideColor, devFlags);
}

function getStandardColors(deviceConfig, overrideColor, subdevice = false){

    if(!deviceConfig){
        throw new Error(`Device config is undefined. Is this a supported mouse?`);
    }

    const RGBData = new Array(deviceConfig.ledSpacing * 3);
    
    // ✅ FlashTap Highlight Farbe (Weiß)
    const flashTapHighlight = flashTapActive ? [255, 255, 255] : null;

    for(let iIdx = 0; iIdx < deviceConfig.ledPositions.length; iIdx++) {
        const ledPosition = deviceConfig.ledPositions[iIdx];

        if(ledPosition === undefined){
            throw new Error(`Device Led Position [${iIdx}] is undefined!`);
        }

        let col;

        if(overrideColor){
            col = hexToRgb(overrideColor);
        }
        // ✅ FlashTap Keys ZUERST checken (höchste Priorität!)
        else if (flashTapHighlight && FLASHTAP_KEY_INDICES.has(iIdx)) {
            col = flashTapHighlight;
        }
        // ✅ Game Mode: Forced Color wenn gameModeForceColor=true
        else if (gameModeActive && gameModeForceColor) {
            col = gameModeColor && gameModeColor !== "#000000" 
                ? hexToRgb(gameModeColor) 
                : hexToRgb(forcedColor);
        }
        else if (LightingMode === "Forced") {
            col = hexToRgb(forcedColor);
        }
        else{
            col = subdevice ? device.subdeviceColor(deviceConfig.name, ledPosition[0], ledPosition[1]) : device.color(ledPosition[0], ledPosition[1]);
        }

        const ledIdx = deviceConfig.ledMap[iIdx];

        RGBData[ledIdx] = col[0];
        RGBData[ledIdx + deviceConfig.ledSpacing] = col[1];
        RGBData[ledIdx + deviceConfig.ledSpacing * 2] = col[2];
    }

    return RGBData;
}

// Keys that get highlighted with `fnHighlightColor` while the Fn key is held —
// matches iCUE's "press Fn, see which keys do something" affordance. List
// reverse-engineered from iCUE's behaviour on the Vanguard Pro 96: the F-row
// (12 keys), the macro/profile/media triggers (M, P, Right Shift, Enter, the
// Numpad shortcuts 0/1/3/7/9, plus Win-Lock and the Elgato button), and Fn
// itself gets a visual feedback glow.
const FN_LAYER_HIGHLIGHT_NAMES = new Set([
	"F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
	"Left Win", "M", "P", "Right Shift", "Enter", "Elgato", "Fn",
	"Num 0", "Num 1", "Num 3", "Num 7", "Num 9",
]);

function getLightingControllerColors(deviceConfig, overrideColor, subdevice = false) {
    if(!deviceConfig){
        throw new Error(`Device config is undefined. Is this a supported mouse?`);
    }

    const RGBData = new Array(deviceConfig.ledMap.length * 3);
    const fnHighlight = (FnEnabled && fnHighlightColor && fnHighlightColor !== "#000000")
        ? hexToRgb(fnHighlightColor)
        : null;
    
    // ✅ FlashTap Highlight Farbe (Weiß)
    const flashTapHighlight = flashTapActive ? [255, 255, 255] : null;

    for(let iIdx = 0; iIdx < deviceConfig.ledPositions.length; iIdx++) {
        const ledPosition = deviceConfig.ledPositions[iIdx];

        if(ledPosition === undefined){
            throw new Error(`Device Led Position [${iIdx}] is undefined!`);
        }

        let col;

        const isFnHighlightKey = fnHighlight && deviceConfig.ledNames && FN_LAYER_HIGHLIGHT_NAMES.has(deviceConfig.ledNames[iIdx]);
        const isLockedWinKey = winLockEnabled && deviceConfig.ledNames && deviceConfig.ledNames[iIdx] === "Left Win";

        if(overrideColor){
            col = hexToRgb(overrideColor);
        }
        // ✅ Linke Win-Taste dunkel halten wenn WinLock aktiv ist —
        // visuelles Feedback dass die Taste blockiert ist.
        else if (isLockedWinKey) {
            col = [0, 0, 0];
        }
        // ✅ FlashTap Keys ZUERST (höchste Priorität vor Fn-Highlight!)
        else if (flashTapHighlight && FLASHTAP_KEY_INDICES.has(iIdx)) {
            col = flashTapHighlight;
        }
        // ✅ Game Mode: Forced Color wenn gameModeForceColor=true
        else if (gameModeActive && gameModeForceColor) {
            col = gameModeColor && gameModeColor !== "#000000"
                ? hexToRgb(gameModeColor)
                : hexToRgb(forcedColor);
        }
        else if (isFnHighlightKey) {
            col = fnHighlight;
        }
        // While Fn is held, every key that is NOT in the highlight set goes
        // dark — matches iCUE's affordance of showing only the actionable
        // keys while Fn is engaged.
        else if (fnHighlight) {
            col = [0, 0, 0];
        }
        else if (LightingMode === "Forced") {
            col = hexToRgb(forcedColor);
        }
        else{
            col = subdevice
                ? device.subdeviceColor(deviceConfig.name, ledPosition[0], ledPosition[1])
                : device.color(ledPosition[0], ledPosition[1]);
        }

        const ledIdx = deviceConfig.ledMap[iIdx];

        RGBData[ledIdx * 3] = col[0];
        RGBData[ledIdx * 3 + 1] = col[1];
        RGBData[ledIdx * 3 + 2] = col[2];
    }

    return RGBData;
}

/**
 * @typedef {{
 * name: string,
 * size: [number, number],
 * ledNames: string[],
 * ledPositions: LedPosition[],
 * ledMap: number[],
 * devFirmware: string
 * ledSpacing: number,
 * keyCount : number,
 * isLightingController : boolean
 * }} CorsairDeviceInfo
 *  */

class CorsairLibrary{
	static HasDeviceName(productId){
		return CorsairLibrary.DeviceList().hasOwnProperty(productId);
	}

	static HasDeviceProductId(productId){
		return CorsairLibrary.GetDeviceNameFromProductId(productId) !== undefined;
	}

	static GetDeviceNameFromProductId(productId){
		const deviceName = CorsairLibrary.ProductIDList()[productId];
		device.log(`Device Name: ${deviceName}`);

		return deviceName;
	}

	static GetDeviceByName(name){
		return CorsairLibrary.DeviceList()[name];
	}

	static GetDeviceByProductId(productId){
		const deviceName = CorsairLibrary.GetDeviceNameFromProductId(productId);

		Assert.isOk(deviceName, `Unknown Device ID: [${productId.toString(16)}]. Reach out to support@signalrgb.com, or visit our Discord to get it added.`);

		return CorsairLibrary.GetDeviceByName(deviceName);
	}

	static GetKeyMapping(keyIdx, deviceType, buttonMapType) {
		if(deviceType === "Keyboard") {
			return CorsairLibrary.KeyboardKeyMapping()[keyIdx];
		} else if(deviceType === "Mouse") {
			return CorsairLibrary.MouseKeyMapping()[buttonMapType][keyIdx];
		}

		device.log(`deviceType ${deviceType} is either undefined or not a keyboard/mouse.`);
	};

	static MouseKeyMapping(){
		return Object.freeze({
			"Default" : {
				//0: "Left Click",
				//1: "Right Click",
				//2: "Middle Click",
				//3: "Forward",
				//4: "Back",
				5: "Dpi Stage Up",
				6: "Dpi Stage Down",
				7: "Profile Switch",
				//8: "Scroll Up",
				//9: "Scroll Down",
			},
			"Sabre" : {
				6: "Dpi Stage Up", //This is a cycle key.
				7: "Profile Switch",
			},
			"M65 Ultra" : {
				4: "Forward",
				3: "Back",
				5: "Dpi Stage Up",
				6: "Dpi Stage Down", //Cycle DPI on Sabre Pro.
				7: "Sniper", //7 is sniper on the M65 Ultra.
			},
			"M75" : {
				6: "Profile Switch",
				7: "Dpi Stage Up", //This is a cycle key.
			},
			"Nightsabre" : {
				3: "Scroll Left",
				4: "Scroll Right",
				7: "Dpi Stage Up",
				8 : "Dpi Stage Down",
				9 : "Profile Down",
				10 : "Profile Up"
			},
			"Scimitar Elite" : {
				//0: "Left Click",
				//1: "Right Click",
				//2: "Middle Click",
				//3: "Forward",
				//4: "Back",
				3: "Dpi Stage Up", //Cycle go round
				5 : "Keypad 1",
				6 : "Keypad 2",
				7 : "Keypad 3",
				8 : "Keypad 4",
				9 : "Keypad 5",
				10 : "Keypad 6",
				11 : "Keypad 7",
				12 : "Keypad 8",
				13 : "Keypad 9",
				14 : "Keypad 10",
				15 : "Keypad 11",
				16 : "Keypad 12",
				//8: "Scroll Up",
				//9: "Scroll Down",
			},
			"Katar" : {
				3: "Forward",
				4: "Back",
				5: "Dpi Stage Up",
			},
		});
	}

	static KeyboardKeyMapping(){
		return Object.freeze({
			//0  : "",
			//1  : "",
			2  : "Brightness",
			//3  : "",
			//4  : "A",
			//5  : "B",
			//6  : "C",
			//7  : "D",
			//8  : "E",
			//9  : "F",
			//10 : "G",
			//11 : "H",
			//12 : "I",
			//13 : "J",
			//14 : "K",
			//15 : "L",
			//16 : "M",
			//17 : "N",
			//18 : "O",
			//19 : "P",
			//20 : "Q",
			//21 : "R",
			//22 : "S",
			//23 : "T",
			//24 : "U",
			//25 : "V",
			//26 : "W",
			//27 : "X",
			//28 : "Y",
			//29 : "Z",
			//30 : "1",
			//31 : "2",
			//32 : "3",
			//33 : "4",
			//34 : "5",
			//35 : "6",
			//36 : "7",
			//37 : "8",
			//38 : "9",
			//39 : "0",
			//40 : "Enter",
			//41 : "Esc",
			//42 : "",
			//43 : "Tab",
			//44 : "Space",
			//45 : "-",
			//46 : "=",
			//47 : "[",
			//48 : "]",
			//49 : "\\",
			//50 : "",
			//51 : ";",
			//52 : "'",
			//53 : "`",
			//54 : ",",
			//55 : ".",
			//56 : "/",
			//57 : "Caps",
			58 : "F1",
			59 : "F2",
			60 : "F3",
			61 : "F4",
			62 : "F5",
			63 : "F6",
			64 : "F7",
			65 : "F8",
			66 : "F9",
			67 : "F10",
			68 : "F11",
			69 : "F12",
			//70 : "Print Screen",
			//71 : "Scroll Lock",
			//72 : "Pause Break",
			//73 : "Insert",
			//74 : "Home",
			//75 : "Page Up",
			//76 : "Delete",
			//77 : "End",
			//78 : "Page Down",
			//79 : "Right Arrow",
			//80 : "Left Arrow",
			//81 : "Down Arrow",
			//82 : "Up Arrow",
			//83 : "Num Lock",
			//84 : "Num /",
			//85 : "Num *",
			//86 : "Num -",
			//87 : "Num +",
			//88 : "Num Enter",
			//89 : "Num 1",
			//90 : "Num 2",
			//91 : "Num 3",
			//92 : "Num 4",
			//93 : "Num 5",
			//94 : "Num 6",
			//95 : "Num 7",
			//96 : "Num 8",
			//97 : "Num 9",
			//98 : "Num 0",
			//99 : "Num .",
			//100 : "",
			//101 : "Menu",
			//102 : "Mute",
			//103 : "Volume Up",
			//104 : "Volume Down",
			//105 : "Left Ctrl",
			//106 : "",
			//107 : "Left Alt",
			108 : "Left Win",
			//109 : "Right Ctrl",
			110 : "Right Shift",
			//111 : "Right Alt",
			//112 : "",
			113 : "Brightness",
			114 : "Lock",
			//115 : "",
			//116 : "",
			//117 : "",
			//118 : "",
			//119 : "",
			//120 : "",
			//121 : "",
			122 : "Fn",
			//123 : "Stop",
			//124 : "Play/Pause",
			//125 : "Skip",
			//126 : "Rewind",
			//127 : "",
			128 : "Profile",
			129 : "Wheel Key", // Vanguard Pro 96 Knob-Push (empirisch via Diagnose-Log in Volume-Mode bestätigt 2026-05-13). Upstream Bragi K100 nutzt 137 für dasselbe — bleibt unten zusätzlich gemappt.
			130 : "Game Mode",
			131 : "G1",
			132 : "G2",
			133 : "G3",
			134 : "G4",
			135 : "G5",
			136 : "G6",
			137 : "Wheel Key",
			//138 : "",
			//139 : "",
			//140 : "",
			//141 : "",
			//142 : "",
			//143 : ""
		});
	}

	static ProductIDList(){
		return Object.freeze({
			0x2B0D : "Vanguard 96",
			0x2B0E : "Vanguard Pro 96"
		});
	}

	// Qt needs to add support for static properties...
	/** @return {Object<string, CorsairDeviceInfo>} */
	static DeviceList(){
		return Object.freeze({
			// Dongle
			"Multipoint Slip Stream Dongle": {
				name: "Slipstream Dongle",
				size: [7, 7],
				ledNames: [],
				ledPositions: [],
				ledMap: [],
				devFirmware: "5.6.126",
				ledSpacing: 0,
				image: "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"
			},
			"Vanguard 96": {
				name: "Vanguard 96",
				size: [22, 6],
				ledNames: [
					"Game Mode",	"Esc",     "F1", "F2", "F3", "F4",   "F5", "F6", "F7", "F8",    "F9", "F10", "F11", "F12",		"Print Screen",	"Del",
					"G1", "`", "1",  "2", "3", "4", "5",  "6", "7", "8", "9", "0",  "-",   "+",  "Backspace",																"NumLock", "Num /", "Num *", "Num -",
					"G2", "Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\",																		"Num 7", "Num 8", "Num 9", "Num +",
					"G3", "CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", 			 "Enter",															"Num 4", "Num 5", "Num 6",
					"G4", "Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", 	  "Right Shift",							"Up Arrow",						"Num 1", "Num 2", "Num 3", "Num Enter",
					"G5", "Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Elgato", 			"Left Arrow",	"Down Arrow",	"Right Arrow",	"Num 0",		  "Num .",

					"ISO_#", "ISO_<", "ABNT2_/"
				],
				ledPositions: [
					[0, 0], [1, 0],			[3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0],		[15, 0], [16, 0],
					[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1],										[18, 1], [19, 1], [20, 1], [21, 1],
					[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2],										[18, 2], [19, 2], [20, 2], [21, 2],
					[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], 		    [14, 3],										[18, 3], [19, 3], [20, 3],
					[0, 4], [1, 4], 		[3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4],		    [14, 4],				 [16, 4],				[18, 4], [19, 4], [20, 4], [21, 4],
					[0, 5], [1, 5], [2, 5], [3, 5],							[7, 5],							 [11, 5], [12, 5], [13, 5], 				[15, 5], [16, 5], [17, 5],		[18, 5],		  [20, 5],

					[13, 3], [2, 4], [13, 4]
				 ],
				ledMap: [
					130, 41, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 76,
					131, 53, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42, 83, 84, 85, 86,
					132, 43, 20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48, 49, 95, 96, 97, 87,
					133, 57, 4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52, 40, 92, 93, 94,
					134, 106, 29, 27, 6, 25, 5, 17, 16, 54, 55, 56, 110, 82, 89, 90, 91, 88,
					135, 105, 108, 107, 44, 111, 122, 136, 80, 81, 79, 98, 99,

					//ISO
					50, 100, 115
				 ],
				devFirmware: "1.21.72",
				ledSpacing: 0,
				keymapType : "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/corsair/keyboards/vanguard-pro-96.png"
			},
			"Vanguard Pro 96": {
				name: "Vanguard Pro 96",
				size: [22, 6],
				ledNames: [
					"Game Mode",	"Esc",     "F1", "F2", "F3", "F4",   "F5", "F6", "F7", "F8",    "F9", "F10", "F11", "F12",		"Print Screen",	"Del",
					"G1", "`", "1",  "2", "3", "4", "5",  "6", "7", "8", "9", "0",  "-",   "+",  "Backspace",																"NumLock", "Num /", "Num *", "Num -",
					"G2", "Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\",																		"Num 7", "Num 8", "Num 9", "Num +",
					"G3", "CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", 			 "Enter",															"Num 4", "Num 5", "Num 6",
					"G4", "Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", 	  "Right Shift",							"Up Arrow",						"Num 1", "Num 2", "Num 3", "Num Enter",
					"G5", "Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Elgato", 			"Left Arrow",	"Down Arrow",	"Right Arrow",	"Num 0",		  "Num .",

					"ISO_#", "ISO_<", "ABNT2_/"
				],
				ledPositions: [
					[0, 0], [1, 0],			[3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0],		[15, 0], [16, 0],
					[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1],										[18, 1], [19, 1], [20, 1], [21, 1],
					[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2],										[18, 2], [19, 2], [20, 2], [21, 2],
					[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], 		    [14, 3],										[18, 3], [19, 3], [20, 3],
					[0, 4], [1, 4], 		[3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4],		    [14, 4],				 [16, 4],				[18, 4], [19, 4], [20, 4], [21, 4],
					[0, 5], [1, 5], [2, 5], [3, 5],							[7, 5],							 [11, 5], [12, 5], [13, 5], 				[15, 5], [16, 5], [17, 5],		[18, 5],		  [20, 5],

					[13, 3], [2, 4], [13, 4]
				 ],
				ledMap: [
					130, 41, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 76,
					131, 53, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42, 83, 84, 85, 86,
					132, 43, 20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48, 49, 95, 96, 97, 87,
					133, 57, 4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52, 40, 92, 93, 94,
					134, 106, 29, 27, 6, 25, 5, 17, 16, 54, 55, 56, 110, 82, 89, 90, 91, 88,
					135, 105, 108, 107, 44, 111, 122, 136, 80, 81, 79, 98, 99,

					//ISO
					50, 100, 115
				 ],
				devFirmware: "2.5.148",
				ledSpacing: 0,
				keymapType : "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/corsair/keyboards/vanguard-pro-96.png"
			}
		});

	}
}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}

function getKeyByValue(object, value) {
	const Key = Object.keys(object).find(key => object[key] === value);

	return parseInt(Key || "");
}

class HexFormatter{
	/**
	 * @param {number} number
	 * @param {number} padding
	 */
	static toHex(number, padding){
		let hex = Number(number).toString(16);

		while (hex.length < padding) {
			hex = "0" + hex;
		}

		return "0x" + hex;
	}
	/**
	 * @param {number} number
	 */
	static toHex2(number){
		return this.toHex(number, 2);
	}
	/**
	 * @param {number} number
	 */
	static toHex4(number){
		return this.toHex(number, 4);
	}
}

class BinaryUtils{
	static WriteInt16LittleEndian(value){
		return [value & 0xFF, (value >> 8) & 0xFF];
	}
	static WriteInt16BigEndian(value){
		return this.WriteInt16LittleEndian(value).reverse();
	}
	static ReadInt16LittleEndian(array){
		return (array[0] & 0xFF) | (array[1] & 0xFF) << 8;
	}
	static ReadInt16BigEndian(array){
		return this.ReadInt16LittleEndian(array.slice(0, 2).reverse());
	}
	static ReadInt32LittleEndian(array){
		return (array[0] & 0xFF) | ((array[1] << 8) & 0xFF00) | ((array[2] << 16) & 0xFF0000) | ((array[3] << 24) & 0xFF000000);
	}
	static ReadInt32BigEndian(array){
		if(array.length < 4){
			array.push(...new Array(4 - array.length).fill(0));
		}

		return this.ReadInt32LittleEndian(array.slice(0, 4).reverse());
	}
	static WriteInt32LittleEndian(value){
		return [value & 0xFF, ((value >> 8) & 0xFF), ((value >> 16) & 0xFF), ((value >> 24) & 0xFF)];
	}
	static WriteInt32BigEndian(value){
		return this.WriteInt32LittleEndian(value).reverse();
	}
}

/**
 * @typedef Options
 * @type {Object}
 * @property {string=} developmentFirmwareVersion
 * @property {number=} LedChannelSpacing
 * @memberof ModernCorsairProtocol
 */
/**
 * @typedef {0 | 1 | 2 | "Lighting" | "Background" | "Auxiliary"} Handle
 * @memberof ModernCorsairProtocol
 */
/**
 * @class Corsair Bragi Protocol Class
 *
 * Major concepts are {@link ModernCorsairProtocol#properties|Properties} and {@link ModernCorsairProtocol#handles|Handles}/{@link ModernCorsairProtocol#endpoints|Endpoints}.
 *
 */

export class ModernCorsairProtocol{

	/** @constructs
	 * @param {Options} options - Options object containing device specific configuration values
	 */
	constructor(options = {}) {
		this.ConfiguredDeviceBuffer = false;

		/**
		 * @property {string} developmentFirmwareVersion - Used to track the firmware version the plugin was developed with to the one on a users device
		 * @property {number} LedChannelSpacing - Used to seperate color channels on non-lighting controller devices.
		 */
		this.config = {
			productId: 0,
			vendorId: 0,
			developmentFirmwareVersion: typeof options.developmentFirmwareVersion === "string" ? options.developmentFirmwareVersion : "Unknown",
			LedChannelSpacing: typeof options.LedChannelSpacing === "number" ? options.LedChannelSpacing : 0,
			WriteLength: 0,
			ReadLength: 0,

			/** @type {CorsairDeviceInfo | undefined} device */
			device: undefined
		};

		this.KeyCodes = [];
		this.KeyCount = 0;

		/**
		 * @readonly
		 * @static
		 * @enum {number}
		 * @property {0x01} setProperty - Used to set a {@link ModernCorsairProtocol#properties|Property} value on the device
		 * @property {0x02} getProperty - Used to fetch a {@link ModernCorsairProtocol#properties|Property} value from the device
		 * @property {0x05} closeHandle - Used to close a device {@link ModernCorsairProtocol#handles|Handle}
		 * @property {0x06} writeEndpoint - Used to write data to an opened device {@link ModernCorsairProtocol#endpoints|Endpoint}.
		 * @property {0x07} streamEndpoint - Used to stream data to an opened device {@link ModernCorsairProtocol#endpoints|Endpoint} if the data cannot fit within one packet
		 * @property {0x08} readEndpoint - Used to read data (i.e Fan Speeds) from a device {@link ModernCorsairProtocol#endpoints|Endpoint}
		 * @property {0x09} checkHandle - Used to check the status of a device {@link ModernCorsairProtocol#endpoints|Endpoint}. Returned data is currently unknown
		 * @property {0x0D} openEndpoint - Used to open an Endpoint on a device {@link ModernCorsairProtocol#handles|Handle}
		 * @property {0x12} pingDevice - Used to ping the device for it's current connection status
		 * @property {0x15} confirmChange - Used to apply led count changes to Commander Core [XT]
		 */
		this.command = Object.freeze({
			setProperty: 0x01,
			getProperty: 0x02,
			closeHandle: 0x05,
			writeEndpoint: 0x06,
			streamEndpoint: 0x07,
			readEndpoint: 0x08,
			checkHandle: 0x09,
			openEndpoint: 0x0D,
			pingDevice: 0x12,
			confirmChange: 0x15
		});
		/**
		 * @enum {number} Modes
		 * @property {0x01} Hardware Mode
		 * @property {0x02} Software Mode
		 */
		this.modes = Object.freeze({
			Hardware: 0x01,
			0x01: "Hardware",
			Software: 0x02,
			0x02: "Software",
		});

		/**
		 * Contains the PropertyId's of all known Properties.
		 * The device values these represent can be read and set using the following commands:
		 * <ul style="list-style: none;">
		 * <li>{@link ModernCorsairProtocol#FetchProperty|FetchProperty(PropertyId)}
		 * <li>{@link ModernCorsairProtocol#ReadProperty|ReadProperty(PropertyId)}
		 * <li>{@link ModernCorsairProtocol#SetProperty|SetProperty(PropertyId, Value)}
		 * <li>{@link ModernCorsairProtocol#CheckAndSetProperty|CheckAndSetProperty(PropertyId, Value)}
		 * </ul>
		 *
		 * Not all Properties are available on all devices and the above functions will throw various errors if they are unsupported, or given invalid values.
		 * Any properties with [READONLY] are constant can only be read from the device and not set by the user.
		 * Properties with [FLASH] are saved to the devices eeprom memory and will persist between power cycles.
		 *
		 * @readonly
		 * @enum {number} Properties
		 * @property {0x01} pollingRate Device's Hardware Polling rate
		 * @property {0x02} brightness Device's Hardware Brightness level in the range 0-1000 [FLASH]
		 * @property {0x03} mode Device Mode [Software/Hardware] PropertyId
		 * @property {0x07} angleSnap Angle Snapping PropertyId. Only used for mice. [FLASH]
		 * @property {0x0D} idleMode Device Idle Mode Toggle PropertyId. Only effects wireless devices.
		 * @property {0x0F} batteryLevel Device Battery Level PropertyID. Uses a 0-1000 Range. [READONLY]
		 * @property {0x10} batteryStatus Device Charging State PropertyID. [READONLY]
		 * @property {0x11} vid Device VendorID PropertyID. [READONLY]
		 * @property {0x12} pid Device ProductID PropertyID. [READONLY]
		 * @property {0x13} firmware Device Firmware PropertyID. [READONLY]
		 * @property {0x14} BootLoaderFirmware Device BootLoader Firmware PropertyID. [READONLY]
		 * @property {0x15} WirelessChipFirmware Device Wireless Chip Firmware PropertyID. [READONLY]
		 * @property {0x1E} dpiProfile Device Current DPI Profile Index PropertyID. Dark Core Pro SE uses a 0-3 Range.
		 * @property {0x1F} dpiMask
		 * @property {0x20} dpi Device's Current DPI Value PropertyID
		 * @property {0x21} dpiX Device's Current X DPI PropertyID
		 * @property {0x22} dpiY Device's Current Y DPI PropertyID.
		 * @property {0x37} idleModeTimeout Device's Idle Timeout PropertyId. Value is in Milliseconds and has a max of 99 Minutes.
		 * @property {0x41} layout Device's Physical Layout PropertyId. Only applies to Keyboards.
		 * @property {0x44} BrightnessLevel Coarse (0-3) Brightness. Effectively sets brightness in 33.33% increments.
		 * @property {0x45} WinLockState Device's WinKey Lock Status. Only applies to Keyboards.
		 * @property {0x46} micMuteStateLegacy Legacy Device Microphone State
		 * @property {0x4A} LockedShortcuts Device's WinKey Lock Bit flag. Governs what key combinations are disabled by the devices Lock mode. Only Applies to Keyboards.
		 * @property {0x96} maxPollingRate Device's Max Polling Rate PropertyId. Not supported on all devices.
		 * @property {0xB0} ButtonResponseOptimization
		 * @property {0xA6} micMuteStateModern Modern Device Microphone State
		 */

		this.properties =  Object.freeze({ //55 and 5A both return their subdevices on the Link Hub. Not sure on other Bragi Proper devices. ICUE Logs note temp sensors and cooling sensors
			pollingRate: 0x01,
			brightness: 0x02,
			mode: 0x03,
			angleSnap: 0x07,
			idleMode: 0x0d,
			batteryLevel: 0x0F,
			batteryStatus: 0x10,
			vid: 0x11,
			pid: 0x12,
			firmware:0x13,
			BootLoaderFirmware: 0x14,
			WirelessChipFirmware: 0x15,
			dpiProfile: 0x1E,
			dpiMask: 0x1F,
			dpi : 0x20,
			dpiX: 0x21,
			dpiY: 0x22,
			subdeviceBitmask: 0x36,
			idleModeTimeout: 0x37,
			layout: 0x41,
			BrightnessLevel: 0x44,
			WinLockState: 0x45,
			micMuteStateLegacy: 0x46,
			LockedShortcuts: 0x4A,
			maxPollingRate: 0x96,
			ButtonResponseOptimization: 0xB0,
			micMuteStateModern: 0xA6
		});

		this.propertyNames = Object.freeze({
			0x01: "Polling Rate",
			0x02: "HW Brightness",
			0x03: "Mode",
			0x07: "Angle Snapping",
			0x0d: "Idle Mode",
			0x0E: "Idle Mode Timeout legacy",
			0x0F: "Battery Level",
			0x10: "Battery Status",
			0x11: "Vendor Id",
			0x12: "Product Id",
			0x13: "Firmware Version",
			0x14: "Bootloader Firmware Version",
			0x15: "Wireless Firmware Version",
			0x16: "Wireless Bootloader Version",
			0x1E: "DPI Profile",
			0x1F: "DPI Mask",
			0x20: "DPI",
			0x21: "DPI X",
			0x22: "DPI Y",
			0x2F: "DPI 0 Color",
			0x30: "DPI 1 Color",
			0x31: "DPI 2 Color",
			0x36: "Wireless Subdevices",
			0x37: "Idle Mode Timeout",
			0x41: "HW Layout",
			0x44: "Brightness Level",
			0x45: "WinLock Enabled",
			0x46: "Mic Mute state legacy",
			0x47: "Sidetone Level",
			0x4a: "WinLock Disabled Shortcuts",
			//0x4B: "???",
			//0x55: "???",
			//0x5A: "???",
			0x5f: "MultipointConnectionSupport",
			//0x66: "???",
			//0x67: "???",
			//0x68: "???",
			//0x78: "???",
			0x96: "Max Polling Rate",
			0xA6: "Mic Mute state modern",
		});

		/**
		 * Contains the EndpointId's of all known Endpoints. These handle advanced device functions like Lighting and Fan Control.
		 * To manually interact with these you must open a Handle to the Endpoint first using {@link ModernCorsairProtocol#OpenHandle|OpenHandle(HandleId, EndpointId)}.
		 *
		 * Helper Functions to interact with these exist as the following:
		 * <ul style="list-style: none;">
		 * <li> {@link ModernCorsairProtocol#WriteToEndpoint|WriteEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#ReadFromEndpoint|ReadEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#CloseHandle|CloseHandle(HandleId)}
		 * <li> {@link ModernCorsairProtocol#CheckHandle|CheckHandle(HandleId)}
		 * </ul>
		 *
		 * @enum {number} Endpoints
		 * @property {0x01} Lighting
		 * @property {0x02} Buttons
		 * @property {0x05} PairingID
		 * @property {0x17} FanRPM
		 * @property {0x18} FanSpeeds
		 * @property {0x1A} FanStates
		 * @property {0x1D} LedCount_3Pin
		 * @property {0x1E} LedCount_4Pin
		 * @property {0x21} TemperatureData
		 * @property {0x22} LightingController
		 * @property {0x27} ErrorLog
		 */
		this.endpoints = Object.freeze({
			Lighting: 0x01,
			Buttons: 0x02,
			PairingID: 0x05,
			FanRPM: 0x17,
			FanSpeeds: 0x18,
			FanStates: 0x1A,
			LedCount_3Pin: 0x1D,
			LedCount_4Pin: 0x1E,
			TemperatureData: 0x21,
			LightingController: 0x22,
			ErrorLog: 0x27,
		});

		this.endpointNames = Object.freeze({
			0x01: "Lighting",
			0x02: "Buttons",
			0x10: "Lighting Monochrome",
			0x17: "Fan RPM",
			0x18: "Fan Speeds",
			0x1A: "Fan States",
			0x1D: "3Pin Led Count",
			0x1E: "4Pin Led Count",
			0x21: "Temperature Probes",
			0x22: "Lighting Controller",
			0x27: "Error Log"
		});

		this.chargingStates = Object.freeze({
			1: "Charging",
			2: "Discharging",
			3: "Fully Charged",
		});

		this.chargingStateDictionary = Object.freeze({
			1 : 2,
			2 : 1,
			3 : 4
		});

		this.dataTypes = Object.freeze({
			FanRPM: 0x06,
			FanDuty: 0x07,
			FanStates: 0x09,
			TemperatureProbes: 0x10,
			LedCount3Pin: 0x0C,
			FanTypes: 0x0D,
			LedConfig: 0x0F,
			LightingController: 0x12
		});

		/**
		 * Contains the HandleId's of usable device Handles. These are used to open internal device {@link ModernCorsairProtocol#endpoints|Endpoint} foradvanced functions like Lighting and Fan Control.
		 * Each Handle can only be open for one {@link ModernCorsairProtocol#endpoints|Endpoint} at a time, and must be closed before the {@link ModernCorsairProtocol#endpoints|Endpoint} can be changed.
		 * For best practice all non-lighting Handles should be closed immediately after you are done interacting with it.
		 *
		 * Auxiliary (0x02) Should only be needed in very specific cases.
		 *
		 * Helper Functions to interact with these exist as the following:
		 * <ul style="list-style: none;">
		 * <li> {@link ModernCorsairProtocol#WriteToEndpoint|WriteEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#ReadFromEndpoint|ReadEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#CloseHandle|CloseHandle(HandleId)}
		 * <li> {@link ModernCorsairProtocol#CheckHandle|CheckHandle(HandleId)}
		 * </ul>
		 */
		this.handles = Object.freeze({
			Lighting: 0x00,
			Background: 0x01,
			Auxiliary: 0x02,
		});

		this.handleNames = Object.freeze({
			0x00: "Lighting",
			0x01: "Background",
			0x02: "Auxiliary"
		});
		/**
		 * Contains the values of all known Fan States. These are returned by {@link ModernCorsairProtocol#FetchFanStates|FetchFanStates}
		 * @enum {number} Endpoints
		 * @property {0x01} Disconnected - This fan Fan Port is empty and has no connected fan.
		 * @property {0x04} Initializing - The state of this Fan Port is still being determined by the device. You should rescan in a few seconds.
		 * @property {0x07} Connected - A Fan a connected to this Port
		 */
		this.fanStates = Object.freeze({
			Disconnected: 0x01,
			Initializing: 0x04,
			Connected: 0x07,
		});

		this.fanTypes = Object.freeze({
			QL: 0x06,
			SpPro: 0x05
		});

		this.pollingRates = Object.freeze({
			1: "125hz",
			2: "250hz",
			3: "500hz",
			4: "1000hz",
			5: "2000hz",
			6: "4000hz",
			7: "8000hz"
		});

		this.pollingRateNames = Object.freeze({
			"125hz": 1,
			"250hz": 2,
			"500hz": 3,
			"1000hz": 4,
			"2000hz": 5,
			"4000hz" : 6,
			"8000hz" : 7
		});

		this.layouts = Object.freeze({
			0x01: "ANSI",
			"ANSI" : 0x01,
			0x02: "ISO",
			"ISO": 0x02
		});

		this.keyStates = Object.freeze({
			Disabled: 0,
			0: "Disabled",
			Enabled: 1,
			1: "Enabled",
		});
	}

	GetNameOfHandle(Handle){
		if(this.handleNames.hasOwnProperty(Handle)){
			return this.handleNames[Handle];
		}

		return "Unknown Handle";
	}
	GetNameOfProperty(Property){
		if(this.propertyNames.hasOwnProperty(Property)){
			return this.propertyNames[Property];
		}

		return "Unknown Property";
	}
	GetNameOfEndpoint(Endpoint){
		if(this.endpointNames.hasOwnProperty(Endpoint)){
			return this.endpointNames[Endpoint];
		}

		return "Unknown Endpoint";
	}
	/** Logging wrapper to prepend the proper context to anything logged within this class. */
	log(Message){
		//device.log(`CorsairProtocol:` + Message);
		device.log(Message);
	}
	/**
	 * This Function sends a device Ping request and returns if the ping was successful.
	 *
	 * This function doesn't seem to affect the devices functionality, but iCUE pings all BRAGI devices every 52 seconds.
	 * @returns {boolean} - Boolean representing Ping Success
	 */
	PingDevice(deviceID = 1){
		const packet = [0x00, deviceID | 0x08, this.command.pingDevice];
		device.write(packet, this.GetWriteLength());

		const returnPacket = device.read(packet, this.GetReadLength());

		if(returnPacket[2] !== 0x12){
			return false;
		}

		return true;
	}

	SetKeyStates(Enabled, keyCount, deviceID = 1){
		this.KeyCodes = [];

		// Assuming a continuous list of key id's
		for(let iIdx = 0; iIdx < keyCount; iIdx++){
			this.KeyCodes.push(Enabled);
		}

		this.WriteToEndpoint("Background", this.endpoints.Buttons, this.KeyCodes, deviceID);
	}

	SetSingleKey(KeyID, Enabled, deviceID = 1){
		this.KeyCodes[KeyID - 1] = Enabled;

		this.WriteToEndpoint("Background", this.endpoints.Buttons, this.KeyCodes, deviceID);
	}

	GetWriteLength(){
		if(!this.ConfiguredDeviceBuffer){
			this.FindBufferLengths();
		}

		return this.config.WriteLength;
	}

	GetReadLength(){
		if(!this.ConfiguredDeviceBuffer){
			this.FindBufferLengths();
		}

		return this.config.ReadLength;
	}

	/**
	 * Finds and sets the device's buffer lengths for internal use within the class.
	 * This should be the first function called when using this Protocol class as all other interactions with the device rely on the buffer size being set properly.
	 *
	 * This is automatically called on the first write/read operation.
	 */
	FindBufferLengths(){

		if(this.ConfiguredDeviceBuffer){
			return;
		}

		const HidInfo = device.getHidInfo();


		this.log(`Setting up device Buffer Lengths...`);

		if(HidInfo.writeLength !== 0){
			this.config.WriteLength = HidInfo.writeLength;
			this.log(`Write length set to ${this.config.WriteLength}`);
		}


		if(HidInfo.readLength !== 0){
			this.config.ReadLength = HidInfo.readLength;
			this.log(`Read length set to ${this.config.ReadLength}`);
		}

		this.ConfiguredDeviceBuffer = true;

	}

	FetchDeviceInformation(deviceID = 1){
		const vendorId = this.FetchProperty(this.properties.vid, deviceID);
		device.log(`Vid: [${HexFormatter.toHex4(vendorId)}]`);
		this.config.vendorId = vendorId;

		const productId = this.FetchProperty(this.properties.pid, deviceID);
		device.log(`Pid: [${HexFormatter.toHex4(productId)}]`);
		this.config.productId = productId;

		 device.log(`Poll Rate is [${this.pollingRates[Corsair.FetchProperty("Polling Rate")]}]`);
		 device.log(`Max Poll Rate is [${this.pollingRates[Corsair.FetchProperty("Max Polling Rate")]}]`);
		 //device.log(`Angle Snap is [${this.FetchProperty("Angle Snapping") ? "Enabled" : "Disabled"}]`);

		// device.log(`DPI X is [${this.FetchProperty("DPI X")}]`);
		// device.log(`DPI Y is [${this.FetchProperty("DPI Y")}]`);

		// device.log(`Brightness is [${this.FetchProperty("HW Brightness")/10}%]`);

		// device.log(`DPI Profile is [${this.FetchProperty("DPI Profile")}]`);
		// //device.log(`DPI Mask is ${Corsair.FetchProperty(Corsair.property.dpiMask)}`);
		//device.log(`HW Layout: ${this.layouts[this.FetchProperty("HW Layout")]}`);
		// device.log(`Idle Mode is [${this.FetchProperty("Idle Mode") ? "Enabled" : "Disabled"}]`);
		// device.log(`Idle Timeout is [${this.FetchProperty("Idle Mode Timeout") / 60 / 1000} Minutes]`);

		this.FetchFirmware(deviceID);

		//DumpAllSupportedProperties();
		//DumpAllSupportedEndpoints();
	}
	FindLightingEndpoint(deviceID = 1){
		let SupportedLightingEndpoint = -1;

		if(this.IsEndpointSupported(this.endpoints.Lighting, deviceID)){
			SupportedLightingEndpoint = this.endpoints.Lighting;
		}else if(this.IsEndpointSupported(this.endpoints.LightingController, deviceID)){
			SupportedLightingEndpoint = this.endpoints.LightingController;
		}

		device.log(`Supported Lighting Style: [${this.GetNameOfEndpoint(SupportedLightingEndpoint)}]`, {toFile: true});

		return SupportedLightingEndpoint;
	}

	IsPropertySupported(PropertyId, deviceID = 1){
		return this.FetchProperty(PropertyId, deviceID) !== -1;
	}

	DumpAllSupportedProperties(deviceID = 1){
		const SupportedProperties = [];
		const MAX_PROPERTY_ID = 0x64;
		device.log(`Checking for properties supported by this device...`);

		for(let i = 0; i < MAX_PROPERTY_ID; i++){
			if(this.IsPropertySupported(i, deviceID)){
				SupportedProperties.push(i);
			}
		}

		for(const property of SupportedProperties){
			device.log(`Supports Property: [${HexFormatter.toHex2(property)}], ${this.GetNameOfProperty(property)}`, {toFile: true});
		}

		return SupportedProperties;

	}

	IsEndpointSupported(Endpoint, deviceID = 1){

		this.CloseHandleIfOpen("Background", deviceID);

		const isHandleSupported = this.OpenHandle("Background", Endpoint, deviceID) === 0;

		// Clean up after if the handle is now open.
		if(isHandleSupported){
			this.CloseHandle("Background", deviceID);
		}

		return isHandleSupported;
	}

	DumpAllSupportedEndpoints(deviceID = 1){
		const SupportedEndpoints = [];
		const MAX_HANDLE_ID = 0x80;
		device.log(`Checking for Endpoints supported by this device...`);

		for(let i = 0; i < MAX_HANDLE_ID; i++){
			if(this.IsEndpointSupported(i, deviceID)){
				SupportedEndpoints.push(i);
			}
		}

		for(const endpoint of SupportedEndpoints){
			device.log(`Supports Endpoint: [${HexFormatter.toHex2(endpoint)}], ${this.GetNameOfEndpoint(endpoint)}`, {toFile: true});
		}

		return SupportedEndpoints;
	}
	/** Fetch if a device supports Battery Reporting. */
	FetchBatterySupport(deviceID = 1) {
		return this.IsPropertySupported(this.properties.batteryLevel, deviceID);
	}
	/** Fetch if a device supports the Lighting Controller RGB Style. */
	FetchLightingControllerSupport(deviceID = 1) {
		return this.IsEndpointSupported(this.endpoints.LightingController, deviceID);
	}
	/** Fetch if a device supports DPI Control. */
	FetchDPISupport(deviceID = 1) {
		device.log("Checking DPI Support");

		if(this.IsPropertySupported(this.properties.dpi, deviceID) ||
		   this.IsPropertySupported(this.properties.dpiX, deviceID) ||
		   this.IsPropertySupported(this.properties.dpiProfile, deviceID)
		) {
			return true;
		}
		//Scimitar Elite really said "Nah I don't support DPI Profiles"
		//And the Nightsabre.

		return false;
	}
	/** Fixes the K100 Air/respective Dongle not responding. */
	ResetDongle() {
		Corsair.SetProperty(23, 0);
		//Literally magic. Do not question this flag.
		//It comes right after App,BLD,Radio_App, and Radio_BLD version.
		//I'm guessing it's a reset flag.
		device.pause(1000);
		Corsair.SetMode("Hardware");
		Corsair.SetMode("Software");
		device.pause(1000);
	}
	/**
	 * Helper function to read and properly format the device's firmware version.
	 */
	FetchFirmware(deviceID){
		const data = this.ReadProperty(this.properties.firmware, deviceID);

		if(this.CheckError(data, "FetchFirmware")){
			return "Unknown";
		}

		const firmwareString = `${data[4]}.${data[5]}.${data[6]}`;
		device.log(`Firmware Version: [${firmwareString}]`, {toFile: true});

		if(this.config.developmentFirmwareVersion !== "Unknown"){
			device.log(`Developed on Firmware [${this.config.developmentFirmwareVersion}]`, {toFile: true});
		}

		return firmwareString;
	}

	/**
	 * Helper function to set the devices current DPI. This will set the X and Y DPI values to the provided value.
	 * @param {number} DPI Desired DPI value to be set.
	 */
	SetDPI(DPI, deviceID = 1){

		const hasIndependentAxes = this.FetchProperty("DPI X", deviceID) !== -1;
		//TODO Should this be stored somewhere? It's an extra variable to add and is a single extra op.
		//Though it does throw an error in console every time dpi is changed if it isn't independent axes.
		//The only place to realistically shove that var is in Corsair Config.
		//This can only be called by a single mouse, and only gets called if we have a mouse.

		if(hasIndependentAxes) {
			this.SetIndependentXYDPI(DPI, deviceID);
		} else {
			device.log(`Device uses Linked XY DPI's. Ignore Above Error Message.`);
			this.SetLinkedXYDPI(DPI, deviceID);
		}
	}
	/**
	 * Helper Function to set the device DPI if it has the ability to take X and Y DPI args separately. This will set the X and Y DPI values to the provided value.
	 * @param {number} DPI Desired DPI value to be set.
	 */
	SetIndependentXYDPI(DPI, deviceID) {
		const CurrentDPI = this.FetchProperty("DPI X", deviceID);

		if(CurrentDPI === DPI){
			return;
		}

		device.log(`Current device DPI is [${CurrentDPI}], Desired value is [${DPI}]. Setting DPI!`);
		this.SetProperty(this.properties.dpiX, DPI, deviceID);
		this.SetProperty(this.properties.dpiY, DPI, deviceID);

		device.log(`DPI X is now [${this.FetchProperty(this.properties.dpiX, deviceID)}]`);
		device.log(`DPI Y is now [${this.FetchProperty(this.properties.dpiX, deviceID)}]`);
	}
	/**
	 * Helper Function to set the device DPI if it only takes a single DPI arg for X and Y axes. This will set the X and Y DPI values to the provided value.
	 * @param {number} DPI Desired DPI value to be set.
	 */
	SetLinkedXYDPI(DPI, deviceID) {
		const CurrentDPI = this.FetchProperty("DPI", deviceID);

		if(CurrentDPI === DPI){
			return;
		}

		device.log(`Current device DPI is [${CurrentDPI}], Desired value is [${DPI}]. Setting DPI!`);
		this.SetProperty(this.properties.dpi, DPI, deviceID);

		device.log(`DPI is now [${this.FetchProperty(this.properties.dpi, deviceID)}]`);
	}

	/**
	 * Helper function to grab the devices battery level and charge state. Battery Level is on a scale of 0-1000.
	 * @returns [number, number] An array containing [Battery Level, Charging State]
	 */
	FetchBatteryStatus(deviceID){
		const BatteryLevel = this.FetchProperty(this.properties.batteryLevel, deviceID);
		const ChargingState = this.FetchProperty(this.properties.batteryStatus, deviceID);

		return [BatteryLevel, ChargingState];
	}
	/**
	 *
	 * @param {number[]} Data - Data packet read from the device.
	 * @param {string} Context - String representing the calling location.
	 * @returns {number} An Error Code if the Data packet contained an error, otherwise 0.
	 */
	CheckError(Data, Context){ //TODO: Rewrite this to add proper handling and dealing with errors in the case of the endpoint not being open.
		const hasError = Data[3] ?? 0;

		if(!hasError){
			return hasError; //Error 2 on setting the HWBrightness on the Dark Core Pro. The return packets for this device seem flipped around with HWBrightness. It sends an odd packet first, and then the expected one.
		}

		const caller_line = (new Error).stack.split("\n")[2];
		const caller_function = caller_line.slice(0, caller_line.indexOf("@"));
		const line_number = caller_line.slice(caller_line.lastIndexOf(":")+1);
		const caller_context = `${caller_function}():${line_number}`;

		switch(Data[3]){
		case 1: // Invalid Value
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Invalid Value Set!`);
			break;
		case 2: // K70 Pro Mini returned this when I gave it RGBData that is too long.
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Packet Exceeds length!`);
			break;

		case 3: // Endpoint Error - Usually indicates an unsupported function
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Operation Failed!`);
			break;

		case 5: // Property Not Supported
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Property is not supported on this device!`);
			break;

		case 6: //Handle not open?
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Handle is not open!`);
			break;

		case 9: // Read only property
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Property is read only!`);
			break;
		case 13:
		case 55:
			// Value still gets set properly?
			//device.log(`${caller_context} CorsairProtocol Unknown Error Code [${hasError}]: ${Context}. This may not be an error.`);
			return 0;
		default:
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: ${Context}`);
		}


		return hasError;
	}
	/**
	 * Helper Function to Read a Property from the device, Check its value, and Set it on the device if they don't match.
	 * 	@param {number|string} PropertyId Property Index to be checked and set on the device. This value can either be the {@link ModernCorsairProtocol#properties|PropertyId}, or the readable string version of it.
	 * 	@param {number} Value The Value to be checked against and set if the device's value doesn't match.
	 *  @return {boolean} a Boolean on if the Property value on the device did match, or now matches the value desired.
	 */
	CheckAndSetProperty(PropertyId, Value, deviceID = 1){
		if(typeof PropertyId === "string"){
			PropertyId = getKeyByValue(this.propertyNames, PropertyId);
		}

		const CurrentValue = this.FetchProperty(PropertyId, deviceID);

		if(CurrentValue === Value){
			return true;
		}

		device.log(`Device ${this.GetNameOfProperty(PropertyId)} is currently [${CurrentValue}]. Desired Value is [${Value}]. Setting Property!`);

		this.SetProperty(PropertyId, Value);
		device.read([0x00], this.GetReadLength(), 5); // TODO: Check if this is needed?

		const NewValue = this.FetchProperty(PropertyId, deviceID);
		device.log(`Device ${this.propertyNames[PropertyId]} is now [${NewValue}]`);

		return NewValue === Value;
	}

	/**
	 * Reads a property from the device and returns the joined value after combining any high/low bytes. This function can return a null value if it's unable to read the property; i.e. it's unavailable on this device.
	 * @param {number | string } PropertyId Property Index to be read from the device. This value can either be the {@link ModernCorsairProtocol#properties|PropertyId}, or the readable string version of it.
	 * @returns The joined value, or undefined if the device fetch failed.
	 */
	FetchProperty(PropertyId, deviceID = 1) {
		if(typeof PropertyId === "string"){
			PropertyId = getKeyByValue(this.propertyNames, PropertyId);
		}

		const data = this.ReadProperty(PropertyId, deviceID);

		// Don't return error codes.
		if(data.length === 0){
			return -1;
		}

		return BinaryUtils.ReadInt32LittleEndian(data.slice(4, 7));
	}

	/**
	 * Attempts to sets a property on the device and returns if the operation was a success.
	 * @param {number|string} PropertyId Property Index to be written to on the device. This value can either be the {@link ModernCorsairProtocol#properties|PropertyId}, or the readable string version of it.
	 * @param {number} Value The Value to be set.
	 * @returns 0 on success, otherwise an error code from the device.
	 */
	SetProperty(PropertyId, Value, deviceID = 1) {
		if(typeof PropertyId === "string"){
			PropertyId = getKeyByValue(this.propertyNames, PropertyId);
		}

		const packet = [0x00, 0x00, deviceID | 0x08, this.command.setProperty, PropertyId, 0x00, (Value & 0xFF), (Value >> 8 & 0xFF), (Value >> 16 & 0xFF)];
		device.clearReadBuffer(); //I added this, it shouldn't technically be necessary as we're really only checking if it worked.
		device.pause(10);
		device.write(packet, this.GetWriteLength());

		const returnPacket = device.read(packet, this.GetReadLength()).slice(2);

		const ErrorCode = this.CheckError(returnPacket, `SetProperty`);

		if(ErrorCode === 1){
			device.log(`Failed to set Property [${this.propertyNames[PropertyId]}, ${HexFormatter.toHex2(PropertyId)}]. [${Value}] is an Invalid Value`);

			return ErrorCode;
		}

		if(ErrorCode === 3){
			device.log(`Failed to set Property [${this.propertyNames[PropertyId]}, ${HexFormatter.toHex2(PropertyId)}]. Are you sure it's supported?`);

			return ErrorCode;
		}

		if(ErrorCode === 9){
			device.log(`Failed to set Property [${this.propertyNames[PropertyId]}, ${HexFormatter.toHex2(PropertyId)}]. The device says this is a read only property!`);

			return ErrorCode;
		}

		return 0;
	}

	/**
	 * Reads a property from the device and returns the raw packet.
	 * @param {number} PropertyId Property Index to be read from the device.  This value can either be the {@link ModernCorsairProtocol#properties|PropertyId}, or the readable string version of it.
	 * @returns The packet data read from the device.
	 */
	ReadProperty(PropertyId, deviceID = 1) {

		const packet = [0x00, 0x00, deviceID, 0x02, this.command.getProperty, ...BinaryUtils.WriteInt16LittleEndian(PropertyId)];
		device.clearReadBuffer();
		device.pause(10);
		device.write(packet, this.GetWriteLength());
		device.pause(10);

		const returnPacket = device.read(packet, this.GetReadLength()).slice(2);

		const ErrorCode = this.CheckError(returnPacket, `ReadProperty`);

		if(ErrorCode){
			device.log(`Failed to read Property [${this.GetNameOfProperty(PropertyId)}, ${HexFormatter.toHex2(PropertyId)}]. Are you sure it's supported?`);

			return [];
		}

		return returnPacket;
	}
	/**
	 * Opens a Endpoint on the device. Only one Endpoint can be open on a Handle at a time so if the handle is already open this function will fail.
	 * @param {Handle} Handle The Handle to open the Endpoint on. Default is 0.
	 * @param {number} Endpoint Endpoint Address to be opened.
	 * @returns 0 on success, otherwise an error code from the device.
	 */
	OpenHandle(Handle, Endpoint, deviceID = 1) {
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}

		const packet = [0x00, 0x00, deviceID, 0x02, this.command.openEndpoint, Handle, Endpoint];
		device.clearReadBuffer();
		device.pause(1);
		device.write(packet, this.GetWriteLength());
		device.pause(1);

		const returnPacket = device.read(packet, this.GetReadLength()).slice(2);

		const ErrorCode = this.CheckError(returnPacket, `OpenHandle`);

		if(ErrorCode){
			device.log(`Failed to open Endpoint [${this.GetNameOfEndpoint(Endpoint)}, ${HexFormatter.toHex2(Endpoint)}] on Handle [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}]. Are you sure it's supported and wasn't already open?`);
		}

		return ErrorCode;
	}
	/**
	 * Closes a Handle on the device.
	 * @param {Handle} Handle The HandleId to Close.
	 * @returns 0 on success, otherwise an error code from the device.
	 */
	CloseHandle(Handle, deviceID = 1) {
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}

		// ✅ KORREKT: Byte-Reihenfolge wie OpenHandle
		const packet = [0x00, 0x00, deviceID, 0x02, this.command.closeHandle, 1, Handle];
		device.clearReadBuffer();
		device.pause(1);
		device.write(packet, this.GetWriteLength());
		device.pause(1);

		const returnPacket = device.read(packet, this.GetReadLength()).slice(2);

		const ErrorCode = this.CheckError(returnPacket, `CloseHandle`);

		if(ErrorCode){
			device.log(`Failed to close Handle [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}]. was it even open?`);
		}

		return ErrorCode;
	}
	/**
	 * Helper function to Check the Handle is currently open and closes it if it is.
	 * @param {Handle} Handle - HandleId to perform the check on.
	 */
	CloseHandleIfOpen(Handle, deviceID = 1){
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}

		if(this.IsHandleOpen(Handle)){
			device.log(`${this.GetNameOfHandle(Handle)} Handle is open. Closing...`);
			this.CloseHandle(Handle, deviceID);
		}
	}

	/**
	 * Performs a Check Command on the HandleId given and returns whether the handle is open.
	 * @param {Handle} Handle - HandleId to perform the check on.
	 * @returns {Boolean} Boolean representing if the Handle is already open.
	 */
	IsHandleOpen(Handle, deviceID = 1){
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}

		device.clearReadBuffer();

		const packet = [0x00, 0x00, deviceID, 0x02, this.command.checkHandle, Handle, 0x00];
		device.pause(1);
		device.write(packet, this.GetWriteLength());
		device.pause(1);

		const returnPacket = device.read(packet, this.GetReadLength()).slice(2);
		const isOpen = returnPacket[5] !== 3;

		return isOpen;
	}

	/**
	 * Performs a Check Command on the HandleId given and returns the packet from the device.
	 * This function will return an Error Code if the Handle is not open.
	 * The Format of the returned packet is currently not understood.
	 * @param {Handle} Handle - HandleId to perform the check on.
	 * @returns The packet read from the device on success. Otherwise and Error Code.
	 * @Deprecated IsHandleOpen should be used in place of this function.
	 */
	CheckHandle(Handle, deviceID = 1){
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}
		const packet = [0x00, 0x00, deviceID, 0x02, this.command.checkHandle, Handle, 0x00];
		device.clearReadBuffer();
		device.pause(10);
		device.write(packet, this.GetWriteLength());
		device.pause(10);

		const returnPacket = device.read(packet, this.GetReadLength()).slice(2);

		const ErrorCode = this.CheckError(returnPacket, `CheckHandle`);

		if(ErrorCode){ //TODO: Add the checker here as well to note if the handle is closed.
			this.CloseHandle(Handle);
			device.log(`Failed to check Handle [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle,)}]. Did you open it?`);

			return ErrorCode;
		}

		return returnPacket;
	}
	/**
	 * This Helper Function will Open, Read, and Close a device Handle for the Endpoint given.
	 * If the read packet does not contain the ResponseId given the packet will be reread up to 4 times before giving up and returning the last packet read.
	 * If the Handle given is currently open this function will close it and then re-attempt opening it.
	 * @param {Handle} Handle - Handle to be used.
	 * @param {number} Endpoint - Endpoint to be read from
	 * @returns The entire packet read from the device.
	 */
	// * @param {number} Command - CommandId that is contained in the return packet to verify the correct packet was read from the device.
	ReadFromEndpoint(Handle, Endpoint, deviceID = 1) {
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}

		if(this.IsHandleOpen(Handle, deviceID)){
			device.log(`CorsairProtocol: Handle is already open: [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}]. Attemping to close...`);
			this.CloseHandle(Handle, deviceID);
		}

		const ErrorCode = this.OpenHandle(Handle, Endpoint, deviceID);

		if(ErrorCode){
			this.CloseHandle(Handle);
			device.log(`CorsairProtocol: Failed to open Device Handle [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}]. Aborting ReadEndpoint operation.`);

			return [];
		}

		device.clearReadBuffer();
		device.pause(1);
		device.write([0x00, 0x00, deviceID, 0x02, this.command.readEndpoint, Handle], this.GetWriteLength());
		device.pause(1);

		//let Data = [];
		const Data = device.read([0x00], this.GetReadLength()).slice(2);

		//const RetryCount = 4;

		// do {
		// 	RetryCount--;
		// 	device.write([0x00, this.ConnectionType, this.command.readEndpoint, Handle], this.GetWriteLength());
		// 	Data = device.read(Data, this.GetReadLength());

		// 	if(this.dataTypes[Data[4]] !== this.dataTypes[Command]) {
		// 		device.log(`Invalid Command Read: Got [${this.dataTypes[Data[2]]}][${Data[4]}], Wanted [${this.dataTypes[Command]}][${Command}]`);
		// 	}

		// } while(this.dataTypes[Data[4]] !== this.dataTypes[Command] && RetryCount > 0);

		this.CloseHandle(Handle, deviceID);

		return Data;
	}
	/**
	 * This Helper Function will Open, Write to, and Close a device Handle for the Endpoint given.
	 *
	 * This function will handle setting the header data expected by the device. If the Data Array Length provided doesn't match what the device's endpoint is expecting the operation will Error.
	 *
	 * If the Handle given is currently open this function will close it and then re-attempt opening it.
	 * @param {Handle} Handle - HandleId to be used.
	 * @param {number} Endpoint - EndpointId to be written too.
	 * @param {number[]} Data - Data to be written to the Endpoint.
	 * @returns {number} 0 on success, otherwise an error code value.
	 */
	WriteToEndpoint(Handle, Endpoint, Data, deviceID = 1) {
		if(typeof Handle === "string"){
			Handle = this.handles[Handle];
		}

		if(this.IsHandleOpen(Handle)){
			device.log(`CorsairProtocol: Handle is already open: [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}]. Attemping to close...`);

			this.CloseHandle(Handle);
		}

		let ErrorCode = this.OpenHandle(Handle, Endpoint, deviceID);

		if(ErrorCode){
			device.log(`CorsairProtocol: Failed to open Device Handle [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}]. Aborting WriteEndpoint operation.`);

			return ErrorCode;
		}

		device.clearReadBuffer();
		device.pause(1);
		device.write([0x00, 0x00, deviceID, 0x02, this.command.writeEndpoint, Handle, ...BinaryUtils.WriteInt32LittleEndian(Data.length)].concat(Data), this.GetWriteLength());

		const returnPacket = device.read([0x00], this.GetReadLength()).slice(2);

		ErrorCode = this.CheckError(returnPacket, `WriteEndpoint`);

		if(ErrorCode){
			device.log(`Failed to Write to Handle [${this.GetNameOfHandle(Handle)}, ${HexFormatter.toHex2(Handle)}].`);
		}

		this.CloseHandle(Handle, deviceID);

		return ErrorCode;
	}
	/**
	 * This Helper Function to write RGB data to the device.
	 * This function will split the data into as many packets as needed
	 * and do multiple WriteEndpoints(Handle, Endpoint, Data) based on the DeviceBufferSize set.
	 *
	 * This function expects the Lighting HandleId (0x00) to already be open.
	 *
	 * This function will handle setting the header data expected by the device.
	 * If the RGBData Array Length provided doesn't match what the devices Lighting Endpoint expects this command will Error.
	 *
	 * @param {number[]} RGBData
	 * - RGBData to be written to the device in a RRRGGGBBB(Lighting Endpoint 0x01) or RGBRGBRGB(LightingController Endpoint 0x22) format.
	 */
	SendRGBData(RGBData, deviceID, isLightingController = false, requiresStreamingRead = false){
		const InitialHeaderSize = 8;
		const HeaderSize = 4;

		const lightingHandle = 0x00;

		// All packets sent to the LightingController Endpoint have these 2 values added before any other data.
		if(isLightingController){
			RGBData.splice(0, 0, ...[this.dataTypes.LightingController, 0x00]);
		}

		// IsHandleOpen ist auf v2-Firmware unzuverlässig (gibt regelmäßig
		// fälschlich "open" zurück). Wir tracken den Handle-State selbst
		// um die kostbaren Per-Frame-Roundtrips zu sparen und um den
		// 50ms-Recovery-Pause-Schmerz zu vermeiden. Endpoint-Wechsel
		// (Lighting ↔ LightingController) erzwingt ein Reopen.
		const lightingEndpoint = isLightingController ? this.endpoints.LightingController : this.endpoints.Lighting;
		if(!this._lightingHandleOpen || this._lightingHandleEndpoint !== lightingEndpoint){
			this.OpenHandle(lightingHandle, lightingEndpoint, deviceID);
			this._lightingHandleOpen = true;
			this._lightingHandleEndpoint = lightingEndpoint;
		}

		let TotalBytes = RGBData.length;
		const InitialPacketSize = this.GetWriteLength() - InitialHeaderSize;

		const writeLightingError = this.WriteLighting(RGBData.length, RGBData.splice(0, InitialPacketSize), lightingHandle, deviceID);

		if(writeLightingError) {
			// Handle ist trotz unseres State-Trackings tot — re-open jetzt
			// sofort statt 50ms zu warten. Caps die FPS sonst auf ~20.
			this.OpenHandle(lightingHandle, lightingEndpoint, deviceID);
			this._lightingHandleOpen = true;
			this._lightingHandleEndpoint = lightingEndpoint;
		}

		TotalBytes -= InitialPacketSize;

		while(TotalBytes > 0){
			const BytesToSend = Math.min(this.GetWriteLength() - HeaderSize, TotalBytes);
			this.StreamLighting(RGBData.splice(0, BytesToSend), lightingHandle, deviceID, requiresStreamingRead);

			TotalBytes -= BytesToSend;
		}
	}


	WriteLighting(LedCount, RGBData, lightingHandle, deviceID = 1){
		const packet =
		[0x00, 0x00, deviceID, 0x02, this.command.writeEndpoint, lightingHandle, ...BinaryUtils.WriteInt32LittleEndian(LedCount)].concat(RGBData);

		device.write(packet, this.GetWriteLength());
		device.pause(1);

		const returnPacket = device.read([0x00], this.GetReadLength()).slice(2);

		const ErrorCode = this.CheckError(returnPacket, `WriteLighting`);

		if(ErrorCode){
			device.log(`WriteLighting Error`);
			// Kein pause(50) hier — der Caller (SendRGBData) re-opent das
			// Handle sofort. Die alte 50ms-Strafe hat die FPS auf ~20
			// gecappt sobald der Error pro Frame kam.

			return true;
		}

		return false;
	}

	/** @private */
	StreamLighting(RGBData, lightingHandle, deviceID = 1, requiresStreamingRead) {
		device.write([0x00, 0x00, requiresStreamingRead ? deviceID | 0x08 : deviceID, 0x02, this.command.streamEndpoint, lightingHandle].concat(RGBData), this.GetWriteLength());
		device.pause(1);

		if(!requiresStreamingRead) {
			return;
		}

		const returnPacket = device.read([0x00], this.GetReadLength()).slice(2);

		this.CheckError(returnPacket, `StreamLighting`);
	}

	/**
	 * Helper Function to Fetch and Set the devices mode. This function will close all currently open Handles on the device to ensure a clean slate and to prevent issues interacting with the device.
	 * Closing Handles in this function leads to iCUE not being able to function anymore, but solves issues with us not being able to find an open handle when trying to access non-lighting endpoints.
	 * @param {number | "Hardware" | "Software"} Mode ModeId to be checks against and set on the device.
	 */
	SetMode(Mode, deviceID = 1){
		if(typeof Mode === "string"){
			Mode = this.modes[Mode];
		}

		let CurrentMode = this.FetchProperty(this.properties.mode, deviceID);

		if(CurrentMode === Mode) {
			return true;
		}

		// if going into hardware mode we want to close all handles.
		// if going into software mode we don't want any handles stuck open from Icue or the file watchdog trigger.
		this.CloseHandleIfOpen("Lighting", deviceID);
		this.CloseHandleIfOpen("Background", deviceID);
		this.CloseHandleIfOpen("Auxiliary", deviceID);

		device.log(`Setting Device Mode to ${this.modes[Mode]}`);
		this.SetProperty(this.properties.mode, Mode, deviceID);
		CurrentMode = this.FetchProperty(this.properties.mode, deviceID);
		device.log(`Mode is now ${this.modes[CurrentMode]}`);

		if(this.modes[CurrentMode] === undefined) {
			return false;
		}

		return true;
	}

	/**
	 * Helper function to set the Hardware level device brightness if it is different then the Brightness value provided. This property is saved to flash.
	 * @param {number} Brightness Brightness Value to be set in the range of 0-1000
	 */
	SetHWBrightness(Brightness, deviceID = 1){
		const HardwareBrightness = this.FetchProperty(this.properties.brightness, deviceID);

		if(HardwareBrightness === Brightness){
			return;
		}

		device.log(`Hardware Level Brightness is ${HardwareBrightness/10}%`);
		this.SetProperty(this.properties.brightness, Brightness, deviceID);
		this.ReadProperty(this.properties.brightness, deviceID);

		device.log(`Hardware Level Brightness is now ${this.FetchProperty(this.properties.brightness, deviceID)/10}%`);

	}

	/**
	 * Helper function to set the device's angle snapping if it is difference then the bool provided. This property is saved to flash.
	 * @param {boolean} AngleSnapping boolean Status to be set for Angle Snapping.
	 */
	SetAngleSnapping(AngleSnapping, deviceID = 1){
		const HardwareAngleSnap = this.FetchProperty(this.properties.angleSnap, deviceID);

		if(!!HardwareAngleSnap !== AngleSnapping){
			device.log(`Device Angle Snapping is set to [${HardwareAngleSnap ? "True" : "False"}]`);

			this.SetProperty(this.properties.angleSnap, AngleSnapping ? 1 : 0, deviceID);

			const NewAngleSnap = this.FetchProperty(this.properties.angleSnap, deviceID);
			device.log(`Device Angle Snapping is now [${NewAngleSnap ? "True" : "False"}]`);
		}
	}

	/** */
	FetchFanRPM(deviceID = 1) {
		//device.log("CorsairProtocol: Reading Fan RPM's.");

		if(device.fanControlDisabled()) {
			device.log("Fan Control is Disabled! Are you sure you want to try this?");

			return [];
		}

		const data = this.ReadFromEndpoint("Background", this.endpoints.FanRPM, deviceID);

		if(data.length === 0){
			this.log("Failed To Read Fan RPM's.");

			return [];
		}

		const FanSpeeds = [];

		if(data[4] !== 6 && data[5] !== 0) {
			device.log("Failed to get Fan RPM's");
		}

		const fanCount = data[6] ?? 0;
		this.log(`Device Reported [${fanCount}] Fan RPM's`);

		const fanSpeeds = data.slice(7, 7 + 2 * fanCount);

		for(let i = 0; i < fanCount; i++) {
			const rpmData = fanSpeeds.splice(0, 2);
			FanSpeeds[i] = BinaryUtils.ReadInt16LittleEndian(rpmData);
		}

		return FanSpeeds;
	}
	/** */
	FetchFanStates(deviceID = 1) {
		const data = this.ReadFromEndpoint("Background", this.endpoints.FanStates, deviceID | 0x08);

		if(data.length === 0){
			device.log(`CorsairProtocol: Failed To Read Fan States.`);

			return [];
		}

		if(data[4] !== 9 || data[5] !== 0) {
			device.log("Failed to get Fan Settings", {toFile: true});

			return [];
		}

		const FanCount = data[6] ?? 0;
		device.log(`CorsairProtocol: Device Reported [${FanCount}] Fans`);

		const FanData = data.slice(7, 7 + FanCount);

		return FanData;
	}
	/** */
	SetFanType(deviceID = 1) {
		// Configure Fan Ports to use QL Fan size grouping. 34 Leds
		const FanCount = 7;

		const FanSettings = [this.dataTypes.FanTypes, 0x00, FanCount];

		for(let iIdx = 0; iIdx < FanCount; iIdx++) {
			FanSettings.push(0x01);
			FanSettings.push(iIdx === 0 ? 0x01 : this.fanTypes.QL); // 1 for nothing, 0x08 for pump?
		}

		this.WriteToEndpoint("Background", this.endpoints.LedCount_4Pin, FanSettings, deviceID);
	}

	SetFanSpeeds(deviceID = 1) {
		const FanCount = 6;
		const DefaultFanSpeed = 0x32;

		const FanSpeedData = [
			this.dataTypes.FanDuty, 0x00, FanCount,
		];

		for(let FanId = 0; FanId < FanCount; FanId++) {
			const FanData = [FanId, 0x00, DefaultFanSpeed, 0x00];

			if(ConnectedFans.includes(FanId)){

				const fanLevel = device.getFanlevel(FanControllerArray[FanId]);
				device.log(`Setting Fan ${FanId + 1} Level to ${fanLevel}%`);
				FanData[2] = fanLevel;
			}

			FanSpeedData.push(...FanData);
		}

		this.WriteToEndpoint("Background", this.endpoints.FanSpeeds, FanSpeedData, deviceID);
	}

	/** */
	FetchTemperatures(deviceID = 1) {
		//device.log(`CorsairProtocol: Reading Temp Data.`);

		const data = this.ReadFromEndpoint("Background", this.endpoints.TemperatureData, deviceID);

		if(data.length === 0){
			device.log(`CorsairProtocol: Failed To Read Temperature Data.`);

			return [];
		}

		if(data[4] !== this.dataTypes.TemperatureProbes || data[5] !== 0) {
			device.log("Failed to get Temperature Data", {toFile: true});

			return [];
		}

		const ProbeTemps = [];
		const ProbeCount = data[6] ?? 0;
		this.log(`Device Reported [${ProbeCount}] Temperature Probes`);

		const TempValues = data.slice(7, 7 + 3 * ProbeCount);

		for(let i = 0; i < ProbeCount; i++) {
			const probe = TempValues.slice(i * 3 + 1, i * 3 + 3);
			const temp = BinaryUtils.ReadInt16LittleEndian(probe) / 10;

			ProbeTemps[i] = temp;
		}

		return ProbeTemps;
	}
}
const Corsair = new ModernCorsairProtocol(options);

class CorsairBragiDongle{
	constructor() {
		this.children = new Map();
	}
	/** Add a Child Device to the Children Map.*/
	addChildDevice(subdeviceID, childDevice, subdevice = true) {
		if(this.children.has(subdeviceID)) {
			device.log("Child Device to Add Already Exists or is Undefined. Skipping!");

			return;
		}

		this.children.set(subdeviceID, childDevice);

		if(subdevice) { createSubdevice(childDevice); }
	}

	/** Remove a Child Device from the Children Map.*/
	removeChildDevice(subdeviceID) {
		if(!this.children.has(subdeviceID)) {
			device.log("Child Device Does Not Exist in Map or is Undefined. Skipping!");

			return;
		}

		device.removeSubdevice(this.children.get(subdeviceID).name);
		this.children.delete(subdeviceID);

	}
}
class CorsairBragiDevice{
/* eslint-disable complexity */
	constructor(device, subdeviceID = 1){

		this.name = device?.name ?? "Unknown Device";
		this.size = device?.size ?? [1, 1];
		this.ledNames = device?.ledNames ?? [];
		this.ledPositions =device?.ledPositions ?? [];
		this.ledMap = device?.ledMap ?? [];
		this.ledSpacing = device?.ledSpacing ?? -1;
		this.image = device?.image ?? "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png";
		this.isLightingController = device?.isLightingController ?? false;
		this.lightingEndpoint = -1;
		this.subdeviceId = subdeviceID;
		this.supportsBattery = false;
		this.keyCount = device?.keyCount ?? 0;
		this.keymapType = device?.keymapType ?? "Unknown";
		this.buttonMap = device?.buttonMap ?? "Unknown";
		this.maxDPI = device?.maxDPI ?? "0";
		this.hasSniperButton = device?.hasSniperButton ?? false;
		this.batteryPercentage = -1;
		this.batteryStatus = -1;
		this.pressedKeys = [];
	}
	toString(){
		return `BragiDevice: \n\tName: ${this.name} \n\tSize: [${this.size}] \n\tSubdeviceId: ${this.subdeviceId}`;
	}
}

export default class DpiController {
	constructor() {
		this.currentStageIdx = 1;
		this.maxSelectedableStage = 5;
		this.maxStageIdx = 5; //Default to 5 as it's most common if not defined
		this.sniperStageIdx = 6;

		this.updateCallback = (dpi) => { this.log("No Set DPI Callback given. DPI Handler cannot function!"); dpi; };

		this.logCallback = (message) => { console.log(message); };

		this.sniperMode = false;
		this.enabled = false;
		this.dpiRollover = false;
		this.dpiMap = new Map();
		this.maxDpi = 18000;
		this.minDpi = 50;
	}
	addProperties() {
		device.addProperty({ "property": "dpiStages", "group": "dpi", "label": "Number of DPI Stages", description: "Sets the number of active DPI stages to cycle though", "step": "1", "type": "number", "min": "1", "max": this.maxSelectedableStage, "default": this.maxStageIdx, "order": 1, "live" : false });
		device.addProperty({ "property": "dpiRollover", "group": "dpi", "label": "DPI Stage Rollover", description: "Allows DPI Stages to loop in a circle, going from last stage to first one on button press", "type": "boolean", "default": "false", "order": 1 });

		try {
			// @ts-ignore
			this.maxStageIdx = dpiStages;
		} catch (e) {
			this.log("Skipping setting of user selected max stage count. Property is undefined");
		}

		this.rebuildUserProperties();
	}
	removeProperties() {
		device.removeProperty("dpiStages");
		device.removeProperty("dpiRollover");
		device.removeProperty(`dpi${this.sniperStageIdx}`);

		for(let stages = 0; stages < this.maxStageIdx; stages++) {
			device.removeProperty(`dpi${stages+1}`);
		}

		this.dpiMap.clear(); //TODO: Do this more properly
	}
	addSniperProperty() {
		device.addProperty({ "property": `dpi${this.sniperStageIdx}`, "group": "dpi", "label": "Sniper Button DPI", "step": "50", "type": "number", "min": this.minDpi, "max": this.maxDpi, "default": "400", "order": 3, "live" : false });
		// eslint-disable-next-line no-eval
		this.dpiMap.set(6, () => { return eval(`dpi${6}`); });
	}
	getCurrentStage() {
		return this.currentStageIdx;
	}
	getMaxStage() {
		return this.maxStageIdx;
	}
	getSniperIdx() { return this.sniperStageIdx; }
	setRollover(enabled) {
		this.dpiRollover = enabled;
	}
	setMaxStageCount(count) {
		this.maxStageIdx = count;
		this.rebuildUserProperties();
	}
	setMinDpi(minDpi) { this.minDpi = minDpi; this.updateDpiRange(); }
	setMaxDpi(maxDpi) { this.maxDpi = maxDpi; this.updateDpiRange(); }
	setUpdateCallback(callback) {
		this.updateCallback = callback;
	}
	active() { return this.enabled; }
	setActiveControl(EnableDpiControl) {
		this.enabled = EnableDpiControl;

		if (this.enabled) {
			this.update();
		}
	}
	/** GetDpi Value for a given stage.*/
	getDpiForStage(stage) {
		if (!this.dpiMap.has(stage)) {
			device.log("bad stage: " + stage);
			this.log("Invalid Stage...");

			return;
		}

		// This is a dict of functions, make sure to call them
		this.log("Current DPI Stage: " + stage);

		const dpiWrapper = this.dpiMap.get(stage);
		const dpi = dpiWrapper();
		this.log("Current DPI: " + dpi);

		// eslint-disable-next-line consistent-return
		return dpi; //ESlint complains about not wanting a return. The dpi call checks if it has a return. If there's no return it does nothing. ESLint can't see that though.
	}
	/** Increment DPIStage */
	increment() {
		this.setStage(this.currentStageIdx + 1);
	}
	/** Decrement DPIStage */
	decrement() {
		this.setStage(this.currentStageIdx - 1);
	}
	/** Set DPIStage and then set DPI to that stage.*/
	setStage(stage) {
		if (stage > this.maxStageIdx) {
			this.currentStageIdx = this.dpiRollover ? 1 : this.maxStageIdx;
		} else if (stage < 1) {
			this.currentStageIdx = this.dpiRollover ? this.maxStageIdx : 1;
		} else {
			this.currentStageIdx = stage;
		}

		this.update();
	}
	/** SetDpi Using Callback. Bypasses setStage.*/
	update() {
		if (!this.enabled) {
			return;
		}
		const stage = this.sniperMode ? this.sniperStageIdx : this.currentStageIdx;
		const dpi = this.getDpiForStage(stage);

		if (dpi) {
			this.updateCallback(dpi);
		}
	}
	/** Stage update check to update DPI if current stage values are changed.*/
	DPIStageUpdated(stage) {
		// if the current stage's value was changed by the user
		// reapply the current stage with the new value
		if (stage === this.currentStageIdx) {
			this.update();
		}
	}
	/** Set Sniper Mode on or off. */
	setSniperMode(sniperMode) {
		this.sniperMode = sniperMode;
		this.log("Sniper Mode: " + this.sniperMode);
		this.update();
	}
	rebuildUserProperties() {
		// Remove Stages

		for (const stage in Array.from(this.dpiMap.keys())) {
			if(+stage+1 === this.sniperStageIdx) {
				continue;
			}

			if (+stage >= this.maxStageIdx) {
				this.log(`Removing Stage: ${+stage+1}`);
				device.removeProperty(`dpi${+stage+1}`);
				this.dpiMap.delete(+stage+1);
			}
		}
		// Add new Stages
		const stages = Array.from(this.dpiMap.keys());

		for (let i = 1; i <= this.maxStageIdx; i++) {
			if (stages.includes(i)) {
				continue;
			}

			this.log(`Adding Stage: ${i}`);
			device.addProperty({ "property": `dpi${i}`, "group": "dpi", "label": `DPI ${i}`, "step": "50", "type": "number", "min": this.minDpi, "max": this.maxDpi, "default": 800 + (400*i), "order": 2, "live" : false });
			// eslint-disable-next-line no-eval
			this.dpiMap.set(i, () => { return eval(`dpi${i}`); });
		}
	}
	updateDpiRange() {
		for (const stage in this.dpiMap.keys()) {
			const prop = device.getProperty(`dpi${+stage}`);
			prop.min = this.minDpi;
			prop.max = this.maxDpi;
			device.addProperty(prop);
		}
	}
	log(message) {
		if (this.logCallback) {
			this.logCallback(message);
		}
	}
}

const DPIHandler = new DpiController();

/**
 * @callback bitArrayCallback
 * @param {number} bitIdx
 * @param {boolean} state
 */

export class BitArray {
	constructor(length) {
		// Create Backing Array
		this.buffer = new ArrayBuffer(length);
		// Byte View
		this.bitArray = new Uint8Array(this.buffer);
		// Constant for width of each index
		this.byteWidth = 8;

		/** @type {bitArrayCallback} */
		this.callback = (bitIdx, state) => {throw new Error("BitArray(): No Callback Available?");};
	}

	toArray() {
		return [...this.bitArray];
	}

	/** @param {number} bitIdx */
	get(bitIdx) {
		const byte = this.bitArray[bitIdx / this.byteWidth | 0] ?? 0;

		return Boolean(byte & 1 << (bitIdx % this.byteWidth));
	}

	/** @param {number} bitIdx */
	set(bitIdx) {
		this.bitArray[bitIdx / this.byteWidth | 0] |= 1 << (bitIdx % this.byteWidth);
	}

	/** @param {number} bitIdx */
	clear(bitIdx) {
		this.bitArray[bitIdx / this.byteWidth | 0] &= ~(1 << (bitIdx % this.byteWidth));
	}

	/** @param {number} bitIdx */
	toggle(bitIdx) {
		this.bitArray[bitIdx / this.byteWidth | 0] ^= 1 << (bitIdx % this.byteWidth);
	}

	/**
	 * @param {number} bitIdx
	 * @param {boolean} state
	 *  */
	setState(bitIdx, state) {
		if(state) {
			this.set(bitIdx);
		} else {
			this.clear(bitIdx);
		}
	}

	/** @param {bitArrayCallback} callback */
	setCallback(callback){
		this.callback = callback;
	}

	/** @param {number[]} newArray */
	update(newArray) {
		// Check Every Byte
		for(let byteIdx = 0; byteIdx < newArray.length; byteIdx++) {
			const value = newArray[byteIdx] ?? 0;

			if(this.bitArray[byteIdx] === value) {
				continue;
			}

			// Check Every bit of every changed Byte
			for (let bit = 0; bit < this.byteWidth; bit++) {
				const isPressed = Boolean((value) & (1 << (bit)));

				const bitIdx = byteIdx * 8 + bit;

				// Skip if the new bit state matches the old bit state
				if(isPressed === this.get(bitIdx)) {
					continue;
				}

				// Save new State
				this.setState(bitIdx, isPressed);

				// Fire callback
				this.callback(bitIdx, isPressed);
			}

		}
	}
}
/* eslint-enable complexity */
const macroInputArray = new BitArray(32);

class PolledFunction{
	constructor(callback, interval){
		this.callback = callback;
		this.interval = interval;
		this.lastPollTime = Date.now();
	}
	Poll(){
		if (Date.now() - this.lastPollTime < this.interval) {
			return;
		}

		this.callback();

		this.lastPollTime = Date.now();
	}
	RunNow(){
		this.callback();

		this.lastPollTime = Date.now();
	}
}
