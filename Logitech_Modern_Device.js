export function Name() { return "Logitech Device"; }
export function VendorId() { return 0x046d; }
export function Documentation() { return "troubleshooting/logitech"; }
export function ProductId() { return LogitechDevice.ProductIDs; }
export function Publisher() { return "WhirlwindFX"; }
export function Size() { return [3, 3]; }
export function DeviceType() { return "dongle"; }
export function Validate(endpoint) { return endpoint.interface === 1 && endpoint.usage === 0x0001 || endpoint.interface === 1 && endpoint.usage === 0x0002 || endpoint.interface === 2 && endpoint.usage === 0x0001 || endpoint.interface === 2 && endpoint.usage === 0x0002; }
export function ImageUrl() { return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
dimTimeoutLength:readonly
idleTimeoutLength:readonly
settingControl:readonly
dpiStages:readonly
dpi1:readonly
dpi2:readonly
dpi3:readonly
dpi4:readonly
dpi5:readonly
dpi6:readonly
dpiLight:readonly
OnboardState:readonly
dpiRollover:readonly
pollingRate:readonly
triggerForce:readonly
clickHaptic:readonly
*/
export function ControllableParameters() {
	const productId = device.productId();

	// IDs für GPro X Superlight 2 (Wireless & Wired)
	const isProX2 = productId === 0xC54D || productId === 0xC09B || productId === 0xC0A8;

	const defaultPollingRates = ["1000", "500", "250", "125"];
	const highPollingRates = ["8000", "4000", "2000", "1000", "500", "250", "125"];
	const pollingValues = (productId === 0xC54D || productId === 0xC0A8) ? highPollingRates : defaultPollingRates;
	const params = [];
	
	// Nur anzeigen, wenn Gerät LEDs hat
	if (!isProX2) {
		params.push(
			{ "property": "shutdownColor", "group": "lighting", "label": "Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", "min": "0", "max": "360", "type": "color", "default": "#000000" },
			{ "property": "LightingMode", "group": "lighting", "label": "Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", "type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas" },
			{ "property": "forcedColor", "group": "lighting", "label": "Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", "min": "0", "max": "360", "type": "color", "default": "#009bde" }
		);
	}

	params.push(
		{ "property": "OnboardState", "group": "", "label": "Onboard Memory Mode", description: "Enables settings saved to the device memory. This will disable SignalRGB Macros and DPI control for this device", "type": "boolean", "default": "false" },
		{ "property": "pollingRate", "group": "", "label": "Polling Rate (hz)", "description": "Sets the Polling Rate of this device", "type": "combobox", "values": pollingValues, "default": "1000" },

	);
	if (isProX2) {
		params.push(
			{ "property": "lodMode", "group": "", "label": "LOD Rate", "description": "Controls how high you can lift the mouse before it stops working. Lower = more precise, Higher = more forgiving.", "type": "combobox", "values": ["Low", "Medium", "High"], "default": "Medium" },
			{ "property": "bhopMode", "group": "", "label": "BHOP (ms)", "description": "The BHOP mode prevents unwanted jumps when the scroll wheel is accidentally triggered. When this option is enabled, the mouse ignores the first scroll event unless a second scroll event occurs within the time window defined on the slider.", "type": "combobox", "values": ["Off", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"], "default": "Off" },
			{ "property": "gameMode", "group": "", "label": "Gaming Mode", "description": "Optimizes sensor settings for specific surfaces: On (gamepads), Off (universal), or Auto (auto-detect)", "type": "combobox", "values": ["On", "Off","Auto"], "default": "On" },
			// Superstrike-only — inductive switch features. Settings apply to BOTH left and right buttons together (G HUB does the same).
			{ "property": "triggerForce", "group": "", "label": "Trigger Force", "description": "Click actuation force for the inductive switches. Level 1 = lightest, Level 10 = stiffest.", "type": "combobox", "values": ["Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8", "Level 9", "Level 10"], "default": "Level 5" },
			{ "property": "clickHaptic", "group": "", "label": "Click Haptic", "description": "Haptic feedback intensity on click (inductive switches only).", "type": "combobox", "values": ["Off", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5"], "default": "Off" }
		);
	}
	return params;
}

let DeviceConnected = false;
let hasLEDs = false;
let savedPollTimer = Date.now();
let savedDPITimer = Date.now();
const PollModeInternal = 10000;

export function LedNames() {
	return [];
}

export function LedPositions() {
	return [];
}

export function Initialize() {
	Logitech.detectDeviceEndpoint();
	LogitechPowerplay.Powerplayinit();
	DeviceConnected = false;

	if (!LogitechDongle.PingDevice()) {
		return;
	}

	DeviceConnected = true;
	Logitech.InitializeDevice();
}

export function Render() {
	sendMousePad();

	if (!DeviceConnected) {
		DeviceConnected = LogitechDongle.PingDevice();

		if (DeviceConnected) {
			Logitech.InitializeDevice();
			device.pause(100);
			PollBattery(true);
			return;
		}
		device.pause(1000);
		return;
	}

	if (LogitechMouse.getEnabledDPILights()) {
		dpiLightAlwaysOnTimeHandler();
	}

	PollBattery();

	hasLEDs = LogitechMouse.getHasDPILights() || LogitechMouse.getHasSniperButton();
	if(hasLEDs){
		device.pause(2);
		DetectInputs();
		device.pause(2);
		grabColors();
	}
}

export function Shutdown(SystemSuspending) {
	const color = SystemSuspending ? "#000000" : shutdownColor;
	sendMousePad(color);
	if(hasLEDs){
		grabColors(color);
	}
	if (settingControl) {
		LogitechMouse.SetOnBoardState(true);
	}

}

export function ondimTimeoutLengthChanged() {
	Logitech.SetLightingDimMinutes();
}

export function onidleTimeoutLengthChanged() {
	Logitech.SetLightingDimMinutes();
}

export function ondpiLightChanged() {
	if (settingControl) {
		LogitechMouse.SetDpiLightAlwaysOn(dpiLight);

		if (!OnboardState) {
			DPIHandler.update(); //Slightly unnecessary but otherwise we're doing way more work for this.
		}
	}
}

export function onsettingControlChanged() {
	if (settingControl && !OnboardState) {
		DPIHandler.setActiveControl(true);
		DPIHandler.update();
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
export function onlodModeChanged() {
	DPIHandler.update();

}
export function onbhopModeChanged() {
	LogitechMouse.setBHOPMode();
}
export function ongameModeChanged() {
	LogitechMouse.setGamingMode();
}
export function ontriggerForceChanged() {
	LogitechMouse.setTriggerSwitchState();
}
export function onclickHapticChanged() {
	LogitechMouse.setTriggerSwitchState();
}
export function onOnboardStateChanged() {

	if (settingControl) {
		LogitechMouse.SetOnBoardState(OnboardState);
	}

	if (settingControl && !OnboardState) {
		DPIHandler.setActiveControl(true);
		DPIHandler.update();
	} else {
		DPIHandler.setActiveControl(false);
	}

	if (OnboardState) {
		if (Logitech.UsesHeroProtocol()) {
			LogitechMouse.SetDPILights(3);
		} else {
			Logitech.SetDirectMode();
		}
	}
}

export function onpollingRateChanged() {
	Logitech.SetPollingRate(pollingRate);
}

function PollBattery(force = false) {
	if (!force && Date.now() - savedPollTimer < PollModeInternal) {
		return;
	}

	savedPollTimer = Date.now();

	if (Logitech.HasBattery()) {
		const bc = Logitech.GetBatteryCharge();
		// Nur setzen, wenn bc nicht undefined, null oder NaN ist
		if (typeof bc === 'number' && !isNaN(bc) && bc >= 0 && bc <= 100) {
			battery.setBatteryLevel(bc);
		}
	}
}

function dpiLightAlwaysOnTimeHandler() {
	if (Date.now() - savedDPITimer < 5000) {
		return;
	}

	if (Logitech.UsesHeroProtocol()) { Logitech.setShortFeature([Logitech.FeatureIDs.RGB8071ID, 0x20, 0x00, 0x00], false, false, "Hero DPI Light", true); } else {
		Logitech.setLongFeature([Logitech.FeatureIDs.LEDControlID, 0x50, 0x01, 0x00, 0x01, 0x00, 0x00], false, "DPI Lights", true);
	}

	LogitechMouse.setEnabledDPILights(false);
}

function DetectInputs() {
	device.set_endpoint(Logitech.GetDeviceEndpoint([`interface`]), Logitech.MessageTypeEndpoints.LongMessageEndpoint, 0xff00);
	do {
		const packet = device.read([0x00], 9, 0);

		macroInputArray.update(ProcessInputs(packet));
	}
	while (device.getLastReadSize() > 0);
}

// eslint-disable-next-line complexity
function ProcessInputs(packet) {
	if (packet[0] === Logitech.MessageTypes.LongMessage && packet[1] === Logitech.GetConnectionType() && packet[2] === Logitech.FeatureIDs.ButtonSpyID) {

		if (packet[4] === 0 && packet[5] === 0 && packet[6] === 0 && packet[7] === 0 && DPIHandler.getSniperMode()) {
			DPIHandler.setSniperMode(false); //The BitIDX system is so far over my head this is my temporary band-aid
		}

		return packet.slice(4, 7);
	}

	if (packet[0] === Logitech.MessageTypes.LongMessage && packet[1] === Logitech.GetConnectionType() && packet[2] === Logitech.FeatureIDs.WirelessStatusID && packet[3] === 0x00 && packet[5] === 0x01) {
		device.log("Waking From Sleep");
		device.pause(1000); //Wait two seconds for handoff.
		device.pause(1000);
		Initialize();

		return [];
	}

	return [];
}

function macroInputHandler(bitIdx, isPressed) {

	const PhysicalbuttonID = LogitechMouse.MapPhysicalButtonIDToName(bitIdx);
	const PhysicalbuttonName = LogitechMouse.GetMouseButtons(PhysicalbuttonID);
	const pressedKey = LogitechMouse.MapButtonNameToSignalRGBValue(PhysicalbuttonName);

	switch (pressedKey) {
		case 7:
			if (!isPressed) { break; }

			DPIHandler.increment();
			device.log("DPI Up");
			break;

		case 6:
			if (!isPressed) { break; }

			device.log("DPI Down");
			DPIHandler.decrement();
			break;
		case 13:
			DPIHandler.setSniperMode(isPressed);

			if (isPressed && settingControl) {
				LogitechMouse.SetDPILights(1);
			}

			break;

		default: {
			// Skip keys only windows should handle.
			if (pressedKey === 0) {
				break;
			}
			// Send Events for any keys we don't handle above
			const eventData = {
				"buttonCode": 0,
				"released": !isPressed,
				"name": PhysicalbuttonName
			};

			//device.log(eventData);

			if (Logitech.GetDeviceType() === "Mouse") {
				mouse.sendEvent(eventData, "Button Press");
			}
		}
	}
}

const PreviousFrameColors = [];

function grabColors(overrideColor) {

	const ledPositions = Logitech.GetDeviceLedPositions();
	const ledIndexes = Logitech.GetDeviceLedIndexes();
	const RGBData = [];
	const isPerLedLightingV2 = Logitech.UsesPerLedLightingV2();
	let packetidx = 0;

	for (let iIdx = 0; iIdx < ledPositions.length; iIdx++) {
		const iX = ledPositions[iIdx][0];
		const iY = ledPositions[iIdx][1];
		let color;

		if (overrideColor) {
			color = hexToRgb(overrideColor);
		} else if (LightingMode === "Forced") {
			color = hexToRgb(forcedColor);
		} else {
			color = device.color(iX, iY);
		}

		if (isPerLedLightingV2) { //PerkeylightingV2 uses a different packet structure than the 8070 and 8071 standards.
			if (PreviousFrameColors[iIdx] && Logitech.CompareArrays(PreviousFrameColors[iIdx], color)) {
				PreviousFrameColors[iIdx] = color;
				continue;
			}


			// Update previous color
			PreviousFrameColors[iIdx] = color;

			RGBData[packetidx] = ledIndexes[iIdx];
			RGBData[packetidx + 1] = color[0];
			RGBData[packetidx + 2] = color[1];
			RGBData[packetidx + 3] = color[2];

			packetidx += 4;
		} else {
			const iLedIdx = ((ledIndexes[iIdx] - 1) * 3);
			RGBData[iLedIdx] = color[0];
			RGBData[iLedIdx + 1] = color[1];
			RGBData[iLedIdx + 2] = color[2];
		}
	}

	Logitech.SendLighting(RGBData);
}

function sendMousePad(overrideColor) {
	if (LogitechPowerplay.Config.hasPowerplay === false) {
		return;
	}

	device.set_endpoint(2, 0x0002, 0xff00); // Lighting IF

	const iX = LogitechPowerplay.Powerplay_Mat.positioning[0][0];
	const iY = LogitechPowerplay.Powerplay_Mat.positioning[0][1];
	let color;

	if (overrideColor) {
		color = hexToRgb(overrideColor);
	} else if (LightingMode === "Forced") {
		color = hexToRgb(forcedColor);
	} else {
		color = device.subdeviceColor("PowerPlayMat", iX, iY);
	}

	device.write([Logitech.MessageTypes.LongMessage, 0x07, 0x0B, 0x30, 0x00, 0x01, color[0], color[1], color[2], 0x02], 20);
}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}

function fetchPerKeyLightingInfo() {
	const validLedIDXs = [];

	//Chop first 3 bytes as those are input args. We don't need those. Yeet
	for (let zones = 0; zones < 3; zones++) {
		const perKeyLightingInfoResponse = Logitech.setSpecificFeature([Logitech.FeatureIDs.PerKeyLightingV2ID, 0x00, 0x00, zones],
			"Long", "Long", Logitech.FeatureIDs.PerKeyLightingV2ID, 5, `Fetch Per Key Lighting Info Zone ${zones}`);

		if (!perKeyLightingInfoResponse.error) {
			const lightingInfoResponseData = perKeyLightingInfoResponse.data.slice(3, 17);
			//GetInfo, zoneInfo, zone
			device.log(lightingInfoResponseData);

			for (let bytes = 0; bytes < lightingInfoResponseData.length; bytes++) {
				for (let i = 1; i < 8; i++) {
					const bitmask = lightingInfoResponseData[bytes];
					const mask = 1 << i;

					if (bitmask & mask) {
						//offset by 8 for mask fun, and then offset by the packet zones.
						const ledIdx = (zones * 112) + (8 * bytes) + i;
						validLedIDXs.push(ledIdx);
						//Fun fact: I can't test the logic because the G515 has 111 as its highest idx lol.
					}
				}
			}
		} //
	}

	device.log(`Valid IDX's: ${validLedIDXs}`);
	//setSpecificLEDs();
}//80 - 95 empty, 96 is empty since 254. chops first bit
//What's weird is that this has everything after that filled, but 99 - 103 don't exist?
// those are in the 264 packet. Really weird stuff. Bitfield states they should be valid.
//After testing they're considered valid zones to the board, but they don't represent any rgb???

function setSpecificLEDs() {
	Logitech.setSpecificFeature([Logitech.FeatureIDs.PerKeyLightingV2ID, 0x10, 103, 255, 255, 255, 98, 0, 0, 0],
		"Long", "Long", Logitech.FeatureIDs.PerKeyLightingV2ID, 5, `Set Single Zone`);

	Logitech.setLongFeature([Logitech.FeatureIDs.PerKeyLightingV2ID, 0x70], true, "Perkey RGB Apply", true);
}

const sortedLedIndexDict = [];

function preProcessKeys() {
	const ledIndexes = Array.from(Logitech.GetDeviceLedIndexes());
	const sortedLedIndexes = [...ledIndexes].sort(function (a, b) { return a - b; });

	for (let leds = 0; leds < ledIndexes.length; leds++) {
		sortedLedIndexDict.push(ledIndexes.indexOf(sortedLedIndexes[leds]));
		//This is somewhat wasteful math, but we're only doing it once.
		//Anything else involved making multiple arrays every single time.
	}

	device.log("Preprocessed key order!");
	device.log(sortedLedIndexDict);
}

//All of this is random scratchpad stuff I did for presorting leds and can aid in dev stuffs? Leaving here in case it can be of future use

export class LogitechDeviceLibrary {
	constructor() {
		/**Library to map Product and Device ID's to Device Types. */
		this.ProductIDs = [
			0xc081, 0xc082, 0xc083, 0xc084, 0xc085, 0xc087, 0xc088, 0xc08b,
			0xc08c, 0xc08d, 0xc08f, 0xc090, 0xc091, 0xc092, 0xc094,
			0xc095, 0xc09d, 0xc332, 0xc33e, 0xc539, 0xc53a, 0xC547,
			0xC541, 0xC545, 0xC343, 0xC348, 0xc359, 0xC096, 0x409D, 0xC347,
			0xC352, 0x40B0, 0xC09E, 0xc548, 0xC356, 0xC357, 0xC355,
			0xC099, 0xC09A, 0xC543, 0xC35B, 0xC351, 0xC54D, 0xC09B, 0xC0A8
		];

		this.DeviceIDs =
		{
			//Wired
			"c081": "G900",
			"c082": "G403 Prodigy",
			"c083": "G403",
			"c084": "G203 Prodigy",
			"c085": "GPro Wired",
			"c086": "G903",
			"c088": "GPro Wireless",
			"c08b": "G502 Hero",
			"c08c": "GPro Wired", //AltPid (╯°□°）╯︵ ┻━┻
			"c08d": "G502 Lightspeed",
			"c08f": "G403 Hero",
			"c087": "G703",
			"c090": "G703",
			"c096": "G705",
			"c091": "G903",
			"c092": "G203 Lightsync",
			"c094": "GPro X Superlight",
			"c095": "G502XPlus",
			"c09e": "G502XPlusMF", // Millenium Falcon
			"c09d": "G203 Lightsync",
			"c332": "G502",
			"c099": "G502 X",
			"c33e": "G915",
			"c343": "G915 TKL",
			"c348": "G713",
			"c347": "G715",
			"c352": "PRO X TKL",
			"c35b": "PRO X TKL", // Rapid
			"c355": "G515",
			"c356": "G915 X",
			"c359": "G915 X",
			"c357": "G915 X TKL",
			"c09a": "GPro 2",
			"c351": "PRO X 60",
			"c09b": "GPro X Superlight 2", // wired
			"c0a8": "G PRO X 2 Superstrike", // wired direct USB connection

			//Wireless
			"405d": "G403 Prodigy",
			"407f": "G502 Lightspeed",
			"4070": "G703",
			"4086": "G703 Hero",
			"409d": "G705",
			"4053": "G900",
			"4067": "G903",
			"4087": "G903",
			"4079": "GPro",
			"4093": "GPro X Superlight",
			"407c": "G915",
			"408e": "G915 TKL",
			"4099": "G502XPlus",
			"40b2": "G502XPlusMF", // Millenium Falcon
			"40a2": "G715",
			"40b0": "PRO X TKL",
			"40b4": "G515",
			"40b5": "G915 X",
			"40b6": "G915 X TKL",
			"40a8": "GPro 2",
			"40af": "PRO X 60",
			"40a9": "GPro X Superlight 2", // wireless
			"40bd": "G PRO X 2 Superstrike" // Lightspeed transport PID — name contains "PRO X 2" so the existing Pro-X-2 setting paths activate

		};
		/** @type {Object.<string, LedPosition[]>} */
		this.vLedPositionDict =
		{
			"Null": [],
			"SingleZoneMouse": [[0, 1]],
			"TwoZoneMouse": [[0, 1], [0, 2]],
			"ThreeZoneMouse": [[0, 1], [1, 2], [2, 1]],
			"G502XPlus": [[6, 2], [6, 0], [0, 1], [1, 1], [5, 1], [4, 1], [3, 1], [2, 1]],

			// Keyboards
			"G515": [
				[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [16, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [13, 3],
				[0, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [13, 4], [15, 4],
				[0, 5], [1, 5], [2, 5], [6, 5], [10, 5], [11, 5], [12, 5], [13, 5], [14, 5], [15, 5], [16, 5],

				[1, 4], [12, 3],

			],
			"G713": [
				[0, 0], [3, 0], [10, 0], [11, 0], [12, 0], [13, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [13, 4],
				[0, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [13, 5], [15, 5],
				[0, 6], [1, 6], [2, 6], [6, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6],

				[1, 5], [12, 4],

				[0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7], [13, 7], [14, 7], [15, 7], [16, 7],
			],
			"G715": [
				[3, 0], [10, 0], [11, 0], [12, 0], [13, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [13, 4],
				[0, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [13, 5], [15, 5],
				[0, 6], [1, 6], [2, 6], [6, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6],

				[1, 5], [12, 4],

				[0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7], [13, 7], [14, 7], [15, 7], [16, 7],
			],
			"G915": [
				[0, 0], [10, 0],
				[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1], [17, 1], [18, 1], [19, 1], [20, 1], [21, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2], [17, 2], [18, 2], [19, 2], [20, 2], [21, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3], [17, 3], [18, 3], [19, 3], [20, 3], [21, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [14, 4], [18, 4], [19, 4], [20, 4],
				[0, 5], [1, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [14, 5], [16, 5], [18, 5], [19, 5], [20, 5], [21, 5],
				[0, 6], [1, 6], [2, 6], [3, 6], [7, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6], [17, 6], [18, 6], [20, 6],

				[2, 5], [13, 4],
			],
			"G915 X": [
				[0, 0], [2, 0], [3, 0], [4, 0], [5, 0], [10, 0],
				[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1], [17, 1], [18, 1], [19, 1], [20, 1], [21, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2], [17, 2], [18, 2], [19, 2], [20, 2], [21, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3], [17, 3], [18, 3], [19, 3], [20, 3], [21, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [14, 4], [18, 4], [19, 4], [20, 4],
				[0, 5], [1, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [14, 5], [16, 5], [18, 5], [19, 5], [20, 5], [21, 5],
				[0, 6], [1, 6], [2, 6], [3, 6], [7, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6], [17, 6], [18, 6], [20, 6],

				[2, 5], [13, 4],
			],
			"G915 X TKL": [
				[0, 0], [3, 0], [10, 0], [11, 0], [12, 0], [13, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [13, 4],
				[0, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [13, 5], [15, 5],
				[0, 6], [1, 6], [2, 6], [6, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6],

				[1, 5], [12, 4],
			],
			"G915 TKL": [
				[0, 0], [3, 0], [10, 0], [11, 0], [12, 0], [13, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [13, 4],
				[0, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [13, 5], [15, 5],
				[0, 6], [1, 6], [2, 6], [6, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6],

				[1, 5], [12, 4],
			],
			"PRO X TKL": [
				[3, 0], [10, 0], [11, 0], [12, 0], [13, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2],
				[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3],
				[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [13, 4],
				[0, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [13, 5], [15, 5],
				[0, 6], [1, 6], [2, 6], [6, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [15, 6], [16, 6],

				[1, 5], [12, 4],
			],
			"PRO X 60": [
				[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0],
				[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1],
				[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [13, 2],
				[0, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [13, 3],
				[0, 4], [1, 4], [2, 4], [6, 4], [10, 4], [11, 4], [12, 4], [13, 4]
			],
		};

		this.vLedsDict = {
			"Null": [],
			"SingleZoneMouse": [1],
			"TwoZoneMouse": [1, 2],
			"ThreeZoneMouse": [1, 2, 3],
			"G502XPlus": [1, 2, 3, 4, 5, 6, 7, 8],

			// Keyboards
			"G515": [
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
				50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79,
				104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76,
				97, 47, // ISO Keys
			],
			"G713": [
				210, 150, 155, 152, 154, 153,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
				50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79,
				104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76,
				97, 47, // ISO Keys

				160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176,
			],
			"G715": [
				150, 155, 152, 154, 153,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
				50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79,
				104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76,
				97, 47, // ISO Keys

				160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176,
			],
			"G915": [
				210, 153,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 158, 155, 157, 156,
				180, 50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72, 80, 81, 82, 83,
				181, 40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75, 92, 93, 94, 84,
				182, 54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37, 89, 90, 91,
				183, 105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79, 86, 87, 88, 85,
				184, 104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76, 95, 96,
				97, 47, // ISO Keys
			],
			"G915 X": [
				210, 185, 186, 187, 188, 153,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 158, 155, 157, 156,
				180, 50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72, 80, 81, 82, 83,
				181, 40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75, 92, 93, 94, 84,
				182, 54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37, 89, 90, 91,
				183, 105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79, 86, 87, 88, 85,
				184, 104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76, 95, 96,
				97, 47, // ISO Keys
			],
			"G915 X TKL": [
				210, 153, 158, 155, 157, 156,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
				50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79,
				104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76,
				97, 47, // ISO Keys
			],
			"G915 TKL": [
				210, 153, 158, 155, 157, 156,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
				50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79,
				104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76,
				97, 47, // ISO Keys
			],
			"PRO X TKL": [
				150, 155, 152, 154, 153,
				38, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
				50, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39, 70, 71, 72,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46, 73, 74, 75,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109, 79,
				104, 107, 106, 41, 110, 111, 98, 108, 77, 78, 76,
				97, 47, // ISO Keys
			],
			"PRO X 60": [
				38, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 42, 43, 39,
				40, 17, 23, 5, 18, 20, 25, 21, 9, 15, 16, 44, 45, 46,
				54, 1, 19, 4, 6, 7, 8, 10, 11, 12, 48, 49, 37,
				105, 26, 24, 3, 22, 2, 14, 13, 51, 52, 53, 109,
				104, 107, 106, 41, 110, 111, 98, 108,
			],
		};

		this.vLedNameDict =
		{
			"Null": [],
			"SingleZoneMouse": ["Primary Zone",],
			"TwoZoneMouse": ["Primary Zone", "Logo Zone"],
			"ThreeZoneMouse": ["Left Zone", "Logo Zone", "Right Zone"],
			"G502XPlus": ["LED 1", "LED 2", "LED 3", "LED 4", "LED 5", "LED 6", "LED 7", "LED 8"],

			// Keyboards
			"G515": [
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break",
				"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
				"ISO_<", "ISO_#",
			],
			"G713": [
				"Logo", "Brightness", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break",
				"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
				"ISO_<", "ISO_#",
				"Underglow LED 1", "Underglow LED 2", "Underglow LED 3", "Underglow LED 4", "Underglow LED 5", "Underglow LED 6", "Underglow LED 7", "Underglow LED 8", "Underglow LED 9",
				"Underglow LED 10", "Underglow LED 11", "Underglow LED 12", "Underglow LED 13", "Underglow LED 14", "Underglow LED 15", "Underglow LED 16", "Underglow LED 17",
			],
			"G715": [
				"Brightness", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break",
				"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
				"ISO_<", "ISO_#",
				"Underglow LED 1", "Underglow LED 2", "Underglow LED 3", "Underglow LED 4", "Underglow LED 5", "Underglow LED 6", "Underglow LED 7", "Underglow LED 8", "Underglow LED 9",
				"Underglow LED 10", "Underglow LED 11", "Underglow LED 12", "Underglow LED 13", "Underglow LED 14", "Underglow LED 15", "Underglow LED 16", "Underglow LED 17",
			],
			"G915": [
				"Logo", "Brightness",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"G1", "`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up", "NumLock", "Num /", "Num *", "Num -",
				"G2", "Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down", "Num 7", "Num 8", "Num 9", "Num +",
				"G3", "CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter", "Num 4", "Num 5", "Num 6",
				"G4", "Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow", "Num 1", "Num 2", "Num 3", "Num Enter",
				"G5", "Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow", "Num 0", "Num .",
				"ISO_<", "ISO_#",
			],
			"G915 X": [
				"Logo", "G6", "G7", "G8", "G9", "Brightness",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"G1", "`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up", "NumLock", "Num /", "Num *", "Num -",
				"G2", "Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down", "Num 7", "Num 8", "Num 9", "Num +",
				"G3", "CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter", "Num 4", "Num 5", "Num 6",
				"G4", "Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow", "Num 1", "Num 2", "Num 3", "Num Enter",
				"G5", "Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow", "Num 0", "Num .",
				"ISO_<", "ISO_#",
			],
			"G915 X TKL": [
				"Logo", "Brightness", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break",
				"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
				"ISO_<", "ISO_#",
			],
			"G915 TKL": [
				"Logo", "Brightness", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break",
				"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
				"ISO_<", "ISO_#",
			],
			"PRO X TKL": [
				"Brightness", "MediaRewind", "MediaPlayPause", "MediaFastForward", "MediaStop",
				"Esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Print Screen", "Scroll Lock", "Pause Break",
				"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Insert", "Home", "Page Up",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", "End", "Page Down",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow",
				"ISO_<", "ISO_#",
			],
			"PRO X 60": [
				"Esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace",
				"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\",
				"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter",
				"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift",
				"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Menu", "Right Ctrl",
			],
		};

		this.ButtonMaps =
		{
			G200Body:
			{
				"button1": "Left Click",
				"button2": "Right Click",
				"button3": "Middle Click",
				"button4": "Backward",
				"button5": "Forward",
				"button6": "DPI UP",
				"button7": "Null",
				"button8": "Null",
				"button9": "Null",
				"button10": "Null",
				"button11": "Null"
			},
			G500Body:
			{
				"button1": "Left Click",
				"button2": "Right Click",
				"button3": "Middle Click",
				"button4": "Backward",
				"button5": "Forward",
				"button6": "Sniper",
				"button7": "Top",
				"button8": "DPI UP",
				"button9": "DPI Down",
				"button10": "Scroll Left",
				"button11": "Scroll Right",
			},
			G502XPlusBody:
			{
				"button1": "Left Click",
				"button2": "Right Click",
				"button3": "Middle Click",
				"button4": "Backward",
				"button5": "Sniper",
				"button6": "Forward",
				"button7": "Top",
				"button8": "Scroll Right",
				"button9": "Scroll Left",
				"button10": "DPI Down",
				"button11": "DPI UP"
			},
			G900Body:
			{
				"button1": "Left Click",
				"button2": "Right Click",
				"button3": "Middle Click",
				"button4": "Backward",
				"button5": "Forward",
				"button6": "Right Back",
				"button7": "DPI UP",
				"button8": "DPI Down",
				"button9": "Right Forward",
				"button10": "Scroll Right",
				"button11": "Scroll Left",
				"button12": "Profile"
			},
		};

		this.buttonMapDict =
		{
			"Left Click": 0,
			"Right Click": 0,
			"Middle Click": 0,
			"Backward": 4,
			"Forward": 5,
			"DPI Down": 6,
			"DPI UP": 7,
			"Scroll Left": 8,
			"Scroll Right": 9,
			"Right Forward": 10,
			"Right Back": 11,
			"Top": 12,
			"Sniper": 13,
			"Profile": 14,
			"Null": 0,
		};

		this.PhysicalButtonIds =
		{
			0: "button7",
			1: "button11",
			2: "button10",
			3: "button12",
			8: "button1",
			9: "button2",
			10: "button3",
			11: "button4",
			12: "button5",
			13: "button6",
			14: "button9",
			15: "button8",
		};

		this.deviceLibrary = {
			"G203 Prodigy": {
				bodyStyle: "G200Body",
				ledStyle: "SingleZoneMouse",
				maxDPI: "8000",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g203-prodigy.png"
			},
			"G203 Lightsync": {
				bodyStyle: "G200Body",
				ledStyle: "ThreeZoneMouse",
				maxDPI: "8000",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g203-lightsync.png"
			},
			"G403": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "12000",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g403.png"
			},
			"G403 Hero": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g403.png"
			},
			"G403 Prodigy": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "12000",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g403.png"
			},
			"G502": {
				bodyStyle: "G500Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "16000",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				hasSniperButton: true,
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g502.png"
			},
			"G502 Hero": {
				bodyStyle: "G500Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				hasSniperButton: true,
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g502.png"
			},
			"G502 Lightspeed": {
				bodyStyle: "G500Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				hasSniperButton: true,
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g502.png"
			},
			"G502 X": {
				bodyStyle: "G200Body",
				ledStyle: "Null",
				maxDPI: "25600",
				Size: [0, 0],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g502-x.png"
			},
			"G502XPlus": {
				bodyStyle: "G502XPlusBody",
				ledStyle: "G502XPlus",
				maxDPI: "25600",
				Size: [7, 3],
				DeviceType: "Mouse",
				hasSniperButton: true,
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g502-x-plus.png"
			},
			"G502XPlusMF": {
				bodyStyle: "G502XPlusBody",
				ledStyle: "G502XPlus",
				maxDPI: "25600",
				Size: [7, 3],
				DeviceType: "Mouse",
				hasSniperButton: true,
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g502-x-plus-millennium-falcon-edition.png"
			},
			"G703": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g703.png"
			},
			"G705": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g705.png"
			},
			"G703 Hero": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g703.png"
			},
			"G900": {
				bodyStyle: "G900Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "12000",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g900.png"
			},
			"G903": {
				bodyStyle: "G900Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g903.png"
			},
			"GPro": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g-pro.png"
			},
			"GPro Wired": {
				bodyStyle: "G200Body",
				ledStyle: "SingleZoneMouse",
				maxDPI: "25600",
				Size: [3, 3],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g-pro.png"
			},
			"GPro X Superlight": {
				bodyStyle: "G200Body",
				ledStyle: "Null",
				maxDPI: "25600",
				Size: [0, 0],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g-pro-x-superlight.png"
			},
			"GPro 2": {
				bodyStyle: "G200Body",
				ledStyle: "TwoZoneMouse",
				maxDPI: "44000",
				Size: [3, 3],
				hasDPILights: true,
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g-pro-2.png"
			},
			"GPro X Superlight 2": {
				bodyStyle: "G200Body",
				ledStyle: "Null",
				maxDPI: "44000",
				Size: [0, 0],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g-pro-x-superlight.png"
			},
			"G PRO X 2 Superstrike": {
				bodyStyle: "G200Body",
				ledStyle: "Null",
				maxDPI: "44000",
				Size: [0, 0],
				DeviceType: "Mouse",
				image: "https://assets.signalrgb.com/devices/brands/logitech/mice/g-pro-x-superlight.png"
			},

			// Keyboards
			"G515": {
				bodyStyle: "null",
				ledStyle: "G515",
				Size: [17, 6],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g515.png"
				//This idiot does throw an error code every time we do led sends. It's unhappy about running keys from 0-12 in the same packet iirc.
				//We don't ECC these packets, so users won't see it.
			},
			"G713": {
				bodyStyle: "null",
				ledStyle: "G713",
				Size: [17, 8],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g713.png"
			},
			"G715": {
				bodyStyle: "null",
				ledStyle: "G715",
				Size: [17, 8],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g715.png"
			},
			"G915": {
				bodyStyle: "null",
				ledStyle: "G915",
				Size: [22, 7],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g915.png"
			},
			"G915 X": {
				bodyStyle: "null",
				ledStyle: "G915 X",
				Size: [22, 7],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g915-x.png"
			},
			"G915 X TKL": {
				bodyStyle: "null",
				ledStyle: "G915 X TKL",
				Size: [17, 7],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g915-x-tkl.png"
			},
			"G915 TKL": {
				bodyStyle: "null",
				ledStyle: "G915 TKL",
				Size: [17, 7],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/g915-tkl.png"
			},
			"PRO X TKL": {
				bodyStyle: "null",
				ledStyle: "PRO X TKL",
				Size: [17, 7],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/pro-x-tkl.png"
			},
			"PRO X 60": {
				bodyStyle: "null",
				ledStyle: "PRO X 60",
				Size: [14, 5],
				DeviceType: "Keyboard",
				image: "https://assets.signalrgb.com/devices/brands/logitech/keyboards/pro-x-60.png"
			},
		};

		this.keyToZoneDict = {
			1: "A", //Logi Bitfield mapping thingy. Needs redone with more data.
			2: "B",
			3: "C",
			4: "D",
			5: "E",
			6: "F",
			7: "G",
			8: "H",
			9: "I",
			10: "J",
			11: "K",
			12: "L",
			13: "M",
			14: "N",
			15: "O",
			16: "P",
			17: "Q",
			18: "R",
			19: "S",
			20: "T",
			21: "U",
			22: "V",
			23: "W",
			24: "X",
			25: "Y",
			26: "Z",
			27: "1",
			28: "2",
			29: "3",
			30: "4",
			31: "5",
			32: "6",
			33: "7",
			34: "8",
			35: "9",
			36: "0",
			37: "Enter",
			38: "Esc",
			39: "Backspace",
			40: "Tab",
			41: "Space",
			42: "-",
			43: "=+",
			44: "[",
			45: "]",
			46: "\\",
			47: "ISO_#", //offset by 1 it seems like? 48 is missing on my G515 which would probably be the ISO key
			48: ";",
			49: "'",
			50: "`",
			51: ",",
			52: ".",
			53: "/",
			54: "CapsLock",
			55: "F1",
			56: "F2",
			57: "F3",
			58: "F4",
			59: "F5",
			60: "F6",
			61: "F7",
			62: "F8",
			63: "F9",
			64: "F10",
			65: "F11",
			66: "F12",
			67: "Print Screen",
			68: "Scroll Lock",
			69: "Pause Break",
			70: "Insert",
			71: "Home",
			72: "Page Up",
			73: "Del",
			74: "End",
			75: "Page Down",
			76: "Right Arrow",
			77: "Left Arrow",
			78: "Down Arrow",
			79: "Up Arrow",
			97: "ISO_/",
			98: "Menu",
			104: "Left Ctrl",
			105: "Left Shift",
			106: "Left Alt",
			107: "Left Win",
			108: "Right Ctrl",
			109: "Right Shift",
			110: "Right Alt",
			111: "Fn"
		};

		this.BatteryVoltageStatusDict =
		{
			0: "Discharging",
			128: "Charging",
			144: "Wireless Charging"
		};

		this.VoltageArray =
			[
				4186, 4156, 4143, 4133, 4122, 4113, 4103, 4094, 4086, 4076, 4067, 4060, 4051, 4043, 4036, 4027, 4019, 4012, 4004, 3997, 3989, 3983, 3976, 3969, 3961, 3955, 3949, 3942, 3935, 3929, 3922, 3916, 3909, 3902, 3896, 3890, 3883, 3877, 3870, 3865, 3859, 3853, 3848, 3842, 3837, 3833, 3828, 3824, 3819, 3815, 3811, 3808, 3804, 3800, 3797, 3793, 3790, 3787, 3784, 3781, 3778, 3775, 3772, 3770, 3767, 3764, 3762, 3759, 3757, 3754, 3751, 3748, 3744, 3741, 3737, 3734, 3730, 3726, 3724, 3720, 3717, 3714, 3710, 3706, 3702, 3697, 3693, 3688, 3683, 3677, 3671, 3666, 3662, 3658, 3654, 3646, 3633, 3612, 3579, 3537, 3500
			];

		this.PercentageLookupTable =
		{
			4186: 100,
			4156: 99,
			4143: 98,
			4133: 97,
			4122: 96,
			4113: 95,
			4103: 94,
			4094: 93,
			4086: 92,
			4076: 91,
			4067: 90,
			4060: 89,
			4051: 88,
			4043: 87,
			4036: 86,
			4027: 85,
			4019: 84,
			4012: 83,
			4004: 82,
			3997: 81,
			3989: 80,
			3983: 79,
			3976: 78,
			3969: 77,
			3961: 76,
			3955: 75,
			3949: 74,
			3942: 73,
			3935: 72,
			3929: 71,
			3922: 70,
			3916: 69,
			3909: 68,
			3902: 67,
			3896: 66,
			3890: 65,
			3883: 64,
			3877: 63,
			3870: 62,
			3865: 61,
			3859: 60,
			3853: 59,
			3848: 58,
			3842: 57,
			3837: 56,
			3833: 55,
			3828: 54,
			3824: 53,
			3819: 52,
			3815: 51,
			3811: 50,
			3808: 49,
			3804: 48,
			3800: 47,
			3797: 46,
			3793: 45,
			3790: 44,
			3787: 43,
			3784: 42,
			3781: 41,
			3778: 40,
			3775: 39,
			3772: 38,
			3770: 37,
			3767: 36,
			3764: 35,
			3762: 34,
			3759: 33,
			3757: 32,
			3754: 31,
			3751: 30,
			3748: 29,
			3744: 28,
			3741: 27,
			3737: 26,
			3734: 25,
			3730: 24,
			3726: 23,
			3724: 22,
			3720: 21,
			3717: 20,
			3714: 19,
			3710: 18,
			3706: 17,
			3702: 16,
			3697: 15,
			3693: 14,
			3688: 13,
			3683: 12,
			3677: 11,
			3671: 10,
			3666: 9,
			3662: 8,
			3658: 7,
			3654: 6,
			3646: 5,
			3633: 4,
			3612: 3,
			3579: 2,
			3537: 1,
			3500: 0
		};
	}
}

const LogitechDevice = new LogitechDeviceLibrary();

/**
 * Protocol Library for Logitech's Peripherals. (HIDPP V2)
 * @class LogitechProtocol
 *
 */
export class LogitechProtocol {
	constructor() {

		this.MessageTypeEndpoints = {
			ShortMessageEndpoint: 0x0001,
			LongMessageEndpoint: 0x0002
		};

		this.MessageTypes = {
			ShortMessage: 0x10,
			LongMessage: 0x11,
			VeryLongMessage: 0x12
		};

		this.DeviceModes = {
			HardwareMode: 0x01,
			SoftwareMode: 0x02
		};

		this.ConnectionType = {
			"Wired": 0xFF,
			"Wireless": 0x01
		};

		this.FeatureIDs =
		{
			DeviceInfoID: 0,
			DeviceNameID: 0,
			FriendlyNameID: 0,
			ResetID: 0,
			BatteryVoltageID: 0,
			UnifiedBatteryID: 0,
			LEDControlID: 0,
			WirelessStatusID: 0,
			ChargingControlID: 0,
			DPIID: 0,
			PollingRateID: 0,
			OnboardProfilesID: 0,
			ButtonSpyID: 0,
			EncryptionID: 0,
			KeyboardLayout2ID: 0,
			PersistentRemappableActionID: 0,
			ReprogrammableControlsV4ID: 0,
			DisableKeysByUsageID: 0,
			GKeyID: 0,
			MKeyID: 0,
			MRID: 0,
			BrightnessControlID: 0,
			HostsInfoID: 0,
			ChangeHostsID: 0,
			PerKeyLightingID: 0,
			RGB8070ID: 0,
			PerKeyLightingV2ID: 0,
			RGB8071ID: 0,
		};

		/** @private */
		this.Config =
		{
			/** Variable for which body style a mouse has to properly register buttons to actions. */
			MouseBodyStyle: "G500Body",
			/** Variable that represents which method a device is connected by. */
			ConnectionMode: 0,
			/** Variable for defining if a mouse supports the 8071 RGB Protocol. */
			IsHeroProtocol: false,
			/** Variable for defining if a mouse supports battery status and level. */
			HasBattery: false,
			/** Object to hold endpoints. Endpoints differ between lightspeed and wired/singlepoint devices.*/
			deviceEndpoint: { "interface": 2, "usage": 0x0001, "usage_page": 0xff00 },
			/** Variable that represents the Device/Product ID of a currently connected device. Used to grab all of our table magic! */
			DeviceID: "0",
			/** Variable that holds a device's name. Used to set device name in the UI. */
			DeviceName: "UNKNOWN",
			/** Variable that holds a device's device type. Used to set Mouse Specific Features. */
			DeviceType: "Mouse", //Since this seems to miss so often, I'd rather it default to what it most likely will be. If we can't figure it out, I can hardcode them to device ID's
			/** Variable that holds current device's LED Names. */
			DeviceLEDNames: [],
			/** Variable that holds current device's LED Positions. */
			DeviceLEDPositions: [],
			/** Variable that holds current device's LED vKeys. */
			DeviceLedIndexes: [],
			/** Variable that holds current device's Max DPI. */
			DeviceMaxDPI: 25600,
		};
		/** Dictionary of Device Feature Pages. */
		this.FeaturePages =
		{
			"Root": 0x0000,
			"FeatureSet": 0x0001,
			"DeviceInfo": 0x0003,
			"DeviceName": 0x0005,
			"FriendlyName": 0x0007,
			"Reset": 0x0020,
			"BatteryVoltage": 0x1001,
			"UnifiedBattery": 0x1004,
			"LEDControl": 0x1300,
			"WirelessStatus": 0x1D4B,
			"ChargingControl": 0x1010,
			"DPI": 0x2201,
			"PollingRate": 0x8060,
			"OnboardProfiles": 0x8100,
			"ButtonSpy": 0x8110,
			"Encryption": 0x4100,
			"KeyboardLayout2": 0x4540,
			"PersistentRemappableAction": 0x1BC0,
			"ReprogrammableControlsV4": 0x1B04,
			"DisableKeysByUsage": 0x4522,
			"GKey": 0x8010,
			"MKey": 0x8020,
			"MR": 0x8030,
			"BrightnessControl": 0x8040,
			"HostsInfo": 0x1815,
			"ChangeHosts": 0x1814,
			"PerKeyLighting": 0x8080,
			"PerKeyLightingV2": 0x8081,
			"RGB8070": 0x8070,
			"RGB8071": 0x8071,
		};
		/** Dictionary of Device Types. */
		this.deviceTypes =
		{
			0: "Keyboard",
			1: "Remote Control",
			2: "Numpad",
			3: "Mouse",
			4: "Trackpad",
			5: "Trackball",
			6: "Presenter",
			7: "Reciever",
			8: "Headset",
			9: "Webcam",
			10: "Steering Wheel",
			11: "Joystick",
			12: "Gamepad",
			13: "Dock",
			14: "Speaker",
			15: "Microphone",
			16: "Illumination Light",
			17: "Programmable Controller",
			18: "Car Sim Pedals",
			19: "Adapter"
		};
		/** Dictionary of Firmware Types. Used to Find the Main Application and Transport ID's. */
		this.FirmwareType =
		{
			0: "Main Application",
			1: "Bootloader(DFU)",
			2: "Hardware",
			3: "Touchpad",
			4: "Optical Sensor",
			5: "SoftDevice",
			6: "RF Companion MCU",
			7: "Factory Application", //Main Application, but it's a factory version and handles DFU process.
			8: "Custom RGB Effect",
			9: "Motor Drive", //10 and above are reserved.
		};
		/** Dictionary of Error Codes to See What You Broke. (╯°□°）╯︵ ┻━┻ */
		this.ErrorCodes =
		{
			0: "NoError",
			1: "Unknown",
			2: "InvalidArgument",
			3: "OutOfRange",
			4: "HardwareError",
			5: "Internal",
			6: "InvalidFeatureIndex",
			7: "InvalidFunctionID",
			8: "Busy",
			9: "Unsupported",

			//Specialty
			10: "MismatchedFeatureID"
		};
	}

	//Getters and Setters

	GetDeviceType() { return this.Config.DeviceType; }
	SetDeviceType(DeviceType) { this.Config.DeviceType = DeviceType; }

	GetConnectionMode() { return this.Config.ConnectionMode; }
	SetConnectionMode(ConnectionMode) { this.Config.ConnectionMode = this.ConnectionType[ConnectionMode]; }

	SetDeviceID(DeviceID) {
		this.DeviceID = DeviceID;
		this.SetDeviceProperties(DeviceID);
	}

	SetDeviceProperties(DeviceID) {
		const deviceLibrary = LogitechDevice.deviceLibrary[LogitechDevice.DeviceIDs[DeviceID]];
		device.setSize(deviceLibrary.Size);

		if (deviceLibrary.hasDPILights) {
			LogitechMouse.setHasDPILights(deviceLibrary.hasDPILights);
			device.log("Device has DPI Lights.");
		}

		if (deviceLibrary.hasSniperButton) {
			LogitechMouse.setHasSniperButton(deviceLibrary.hasSniperButton);
			device.log("Device has sniper button.");
		}

		if (deviceLibrary.maxDPI) {
			this.SetDeviceMaxDPI(deviceLibrary.maxDPI);
		}

		this.SetMouseBodyType(deviceLibrary.bodyStyle);
		if (deviceLibrary.ledStyle !== "Null") {
			device.log("Device has LEDS");
			this.SetDeviceLedNames(LogitechDevice.vLedNameDict[deviceLibrary.ledStyle]);
			this.SetDeviceLedIndexes(LogitechDevice.vLedsDict[deviceLibrary.ledStyle]);
			this.SetDeviceLedPositions(LogitechDevice.vLedPositionDict[deviceLibrary.ledStyle]);
		}
		this.SetDeviceType(deviceLibrary.DeviceType);
		this.SetDeviceImage(deviceLibrary.image);
		if (deviceLibrary.ledStyle !== "Null") {
			device.setControllableLeds(this.Config.DeviceLEDNames, this.Config.DeviceLEDPositions);
		}
		device.setImageFromUrl(this.GetDeviceImage());
	}

	GetDeviceMaxDPI() { return this.Config.DeviceMaxDPI; }
	SetDeviceMaxDPI(MaxDPI) { this.Config.DeviceMaxDPI = MaxDPI; }

	GetDeviceLedNames() { return this.Config.DeviceLEDNames; }
	SetDeviceLedNames(LedNames) { this.Config.DeviceLEDNames = LedNames; }

	GetDeviceLedPositions() { return this.Config.DeviceLEDPositions; }
	SetDeviceLedPositions(LedPositions) { this.Config.DeviceLEDPositions = LedPositions; }

	GetDeviceLedIndexes() { return this.Config.DeviceLedIndexes; }
	SetDeviceLedIndexes(LedIndexes) { this.Config.DeviceLedIndexes = LedIndexes; }

	GetConnectionType() { return this.Config.ConnectionMode; }

	GetMouseBodyType() { return this.Config.MouseBodyStyle; }
	SetMouseBodyType(BodyType) { this.Config.MouseBodyStyle = BodyType; }

	GetDeviceImage() { return this.Config.DeviceImage; }
	SetDeviceImage(Image) { this.Config.DeviceImage = Image; }

	GetDeviceEndpoint(endpoint) { return this.Config.deviceEndpoint[endpoint]; }

	SetDeviceSize(DeviceSize) {
		this.Config.DeviceSize = DeviceSize;
		device.setSize(Logitech.Config.DeviceSize);
	}
	HasLED() { return this.Config.ledStyle; }

	UsesHeroProtocol() { return this.Config.IsHeroProtocol; }
	HasBattery() { return this.Config.HasBattery; }
	UsesPerLedLightingV2() { return this.FeatureIDs.PerKeyLightingV2ID !== 0; }

	//Helper Functions
	CompareArrays(array1, array2) {
		return array1.length === array2.length &&
			array1.every(function (value, index) { return value === array2[index]; });
	}
	/** Clear Short Read Buffer to Ensure Good Returns. */
	clearShortReadBuffer() {
		device.set_endpoint(this.Config.deviceEndpoint[`interface`], this.MessageTypeEndpoints.ShortMessageEndpoint, 0xff00); // Short Message Endpoint
		device.clearReadBuffer();
	}
	/** Clear Long Read Buffer to Ensure Good Returns. */
	clearLongReadBuffer() {
		device.set_endpoint(this.Config.deviceEndpoint[`interface`], this.MessageTypeEndpoints.LongMessageEndpoint, 0xff00); // Long Message Endpoint
		device.clearReadBuffer();
	}
	/** Fetch Info From the Short Endpoint. */
	getShortFeature() {
		device.set_endpoint(this.Config.deviceEndpoint[`interface`], this.MessageTypeEndpoints.ShortMessageEndpoint, 0xff00);

		const returnPacket = device.read([0x00], 7, 20);
		const response = new LogitechResponse(returnPacket);

		if (response.error !== 0x00 && response.error < 11) {
			device.log(`getShortFeature Function returned an error code. Returned Error Code: ${this.ErrorCodes[response.error]}`);
		}

		return response;
	}
	/** Fetch Info From the Long Endpoint. */
	getLongFeature(callingFunction) {
		device.set_endpoint(this.Config.deviceEndpoint[`interface`], this.MessageTypeEndpoints.LongMessageEndpoint, 0xff00);

		const returnPacket = device.read([0x00], 20, 20);
		// console.log(returnPacket)
		const response = new LogitechResponse(returnPacket);

		if (response.error !== 0x00 && response.error < 11 && callingFunction !== "Unified Battree") {
			device.log(`getLongFeature Function returned an error code. Returned Error Code: ${this.ErrorCodes[response.error]}`);
		}

		return response;
	}
	/** Send Short Data. */
	setShortFeature(data, NoResponse, forceWired, callingFunction, noDelay = false) {
		device.set_endpoint(this.Config.deviceEndpoint[`interface`], this.MessageTypeEndpoints.ShortMessageEndpoint, 0xff00);

		if (!noDelay) { device.pause(30); this.clearShortReadBuffer(); }

		device.write([this.MessageTypes.ShortMessage, forceWired ? this.ConnectionType["Wired"] : this.Config.ConnectionMode, ...data], 7);

		if (NoResponse) {
			return new LogitechResponse([]);
		}

		const returnPacket = device.read([0x00], 7, 20);

		const response = new LogitechResponse(returnPacket);

		if (response.error !== 0x00 && response.error < 11 && !forceWired) { //Force Wired is used for HIDPP V1 Talkback with Receiver. So it doesn't play by the rules of HIDPPV2.
			device.log(`${callingFunction} Function returned an error code. Returned Error Code: ${this.ErrorCodes[response.error]}`);
		}

		return response;
	}
	/** Send Long Data. */
	setLongFeature(data, NoResponse, callingFunction, noDelay = false) {
		device.set_endpoint(this.Config.deviceEndpoint[`interface`], this.MessageTypeEndpoints.LongMessageEndpoint, 0xff00);

		if (!noDelay) { device.pause(30); this.clearLongReadBuffer(); }

		const packet = [this.MessageTypes.LongMessage, this.Config.ConnectionMode, ...data];
		device.write(packet, 20);

		if (NoResponse) {
			return new LogitechResponse([]);
		}

		const returnPacket = device.read([0x00], 20, 20);
		const response = new LogitechResponse(returnPacket);

		if (response.error !== 0x00 && response.error < 11) {
			device.log(`${callingFunction} Function returned an error code. Returned Error Code: ${this.ErrorCodes[response.error]}`);
		}

		return response;
	}
	/** Data Sender With Integrated Retry Handler. */
	setSpecificFeature(data, sendPacketType, returnPacketType, FeatureId, attempts = 5, callingFunction) {
		let response;

		do {
			if (sendPacketType === "Short" && returnPacketType === "Long") {
				this.clearLongReadBuffer();
				this.setShortFeature(data, true, false, callingFunction, true);
				response = this.getLongFeature(callingFunction);
			} else if (sendPacketType === "Long") {
				response = this.setLongFeature(data, false, callingFunction);
			} else {
				response = this.setShortFeature(data, false, false, callingFunction);
			}

			if (response.featureId === FeatureId) {
				return response;
			}
			device.pause(1000);
			attempts -= 1;
		} while (attempts > 0);

		const failure = new LogitechResponse([]);
		failure.error = this.ErrorCodes[10];

		return failure;
	}
	/** Handler for Wired vs Wireless Devices. */ //Oversiplification of it, since some wireless devices use the first endpoint.
	detectDeviceEndpoint() {

		const deviceEndpoints = device.getHidEndpoints();

		for (let endpoints = 0; endpoints < deviceEndpoints.length; endpoints++) {
			const endpoint = deviceEndpoints[endpoints];

			if (endpoint) {
				if (endpoint[`interface`] === 2 && endpoint[`usage`] === 1 && endpoint[`usage_page`] === 0xff00) {
					this.Config.deviceEndpoint[`interface`] = endpoint[`interface`];
					device.log("Device is Multipoint Connection/Lightspeed.");
				} else if (endpoint[`interface`] === 1 && endpoint[`usage`] === 1 && endpoint[`usage_page`] === 0xff00) {
					this.Config.deviceEndpoint[`interface`] = endpoint[`interface`];
					device.log("Device is Singlepoint Connection.");
				}
			}
		}
	}

	//Actual Device Functions
	/** Initialize the Device and Prepare For Rendering. */
	InitializeDevice() {
		this.FetchFeatureIDsFromDevice();
		this.ConfigureSettingsBasedOnFeatureIds();

		const CommunicationID = this.FetchDeviceInfo();

		if (LogitechDevice.DeviceIDs.hasOwnProperty(CommunicationID)) {
			device.log("Matching Device ID Found");
			this.SetDeviceID(CommunicationID);
		} else {
			DeviceConnected = false;

			return; //Kick back to pairing check if our DeviceIDCheck fails. I should probably add a timeout here, but we'll see. At the very least this doesn't lock up the render loop.
		}

		this.FetchDeviceName();


		if (this.SupportsFeaturePage(this.FeaturePages.FriendlyName)) {
			device.log("Device Supports Friendly Name.", { toFile: true });
			this.FetchFriendlyDeviceName();
			this.FetchDefaultFriendlyDeviceName();
		}

		this.SetDirectMode(OnboardState);

		this.SetPollingRate(pollingRate);
		macroInputArray.setCallback((bitIdx, isPressed) => { return macroInputHandler(bitIdx, isPressed); });

		if (this.GetDeviceType() === "Mouse") {
			LogitechMouse.configureMouseSettings();
		} else if (this.GetDeviceType() === "Keyboard") {
			LogitechKeyboard.configureKeyboardSettings();
		}

		if (this.HasBattery()) {
			device.addFeature("battery");
			battery.setBatteryLevel(this.GetBatteryCharge());
		}

		// Fetch Dim and Timeout Settings
		if (this.HasLED()) {
			this.GetLightingDimMinutes();
		}
	}
	/** Grab Feature ID's Off of the Device Using the Feature Pages. */
	FetchFeatureIDsFromDevice() {
		device.log(`----Scanning Feature Pages----`);

		for (const [Feature, Page] of Object.entries(this.FeaturePages)) {
			const FeatureID = this.FetchFeatureIdFromPage(Page);


			if (FeatureID !== undefined) {
				if (FeatureID > 0) {
					this.FeatureIDs[Feature + 'ID'] = FeatureID;
					device.log(Feature + " FeatureID: " + this.FeatureIDs[Feature + 'ID'], { toFile: true });
				}
			}
		}

		device.log(`----End Of Feature Pages----`);
	}
	/** Handler to Fetch a Specific Feature ID. */
	FetchFeatureIdFromPage(featurePage) {
		let FeatureID = this.setSpecificFeature([0x00, 0x00, (featurePage >> 8) & 0xFF, featurePage & 0xFF], "Long", "Long", 0x00, 10).data[1];

		//I'm not dealing with No Connect Edge Cases.
		if (FeatureID !== undefined) {

			if (FeatureID > 64) {
				FeatureID = 0;
			}

			return FeatureID;
		}

		return -1;
	}

	/** Helper to Reference Back A Feature ID to a Feature Page. */
	GetFeatureIdOfFeaturePage(FeaturePage) {
		// Doing a reverse lookup here and then checking for the feature Id.
		// This is convoluted but we'll need to change our data structures to fix this.
		// Hiding the logic in here means we can unit test before making that change to know nothing is busted.
		for (const [Feature, Page] of Object.entries(this.FeaturePages)) {
			if (Page === FeaturePage) {
				return this.FeatureIDs[Feature + "ID"];
			}
		}

		return -1;
	}
	/** Function to Ask Whether or Not a Device Supports a Given Feature Page. */
	SupportsFeaturePage(FeaturePage) {
		return this.GetFeatureIdOfFeaturePage(FeaturePage) > 0;
	}
	/** Set Hero and Battery Variables Using Feature ID's. */
	ConfigureSettingsBasedOnFeatureIds() {
		// Devices with these FeatureId fall under the 'Hero' variant
		if (this.FeatureIDs.RGB8071ID !== 0) {
			this.Config.IsHeroProtocol = true;
		}

		// Devices with these FeatureIds have batteries we can poll
		if (this.FeatureIDs.UnifiedBatteryID !== 0 || this.FeatureIDs.BatteryVoltageID !== 0) {
			this.Config.HasBattery = true;
		}
	}
	/** Fetch Transport ID's and All Other Firmware Info Off of the Device. */
	FetchDeviceInfo() {
		device.log(`----Fetching Device Information----`);

		const DeviceInfoResponsePacket = this.setSpecificFeature([this.FeatureIDs.DeviceInfoID, 0x00], "Short", "Long", this.FeatureIDs.DeviceInfoID, 10).data;

		const TotalEntities = DeviceInfoResponsePacket[1];
		const UniqueIdentifier = DeviceInfoResponsePacket.slice(2, 6);
		const Transport1 = DeviceInfoResponsePacket[8].toString(16) + DeviceInfoResponsePacket[9].toString(16);
		const Transport2 = DeviceInfoResponsePacket[10].toString(16) + DeviceInfoResponsePacket[11].toString(16);
		const Transport3 = DeviceInfoResponsePacket[12].toString(16) + DeviceInfoResponsePacket[13].toString(16);
		const SerialNumberSupport = DeviceInfoResponsePacket[15];
		device.log("Total Entities: " + TotalEntities, { toFile: true });
		device.log("Unique Device Identifier: " + UniqueIdentifier, { toFile: true });
		device.log("Transport 1 Model ID: " + Transport1, { toFile: true });
		device.log("Transport 2 Model ID: " + Transport2, { toFile: true });
		device.log("Transport 3 Model ID: " + Transport3, { toFile: true });
		device.log("Serial Number Support:" + SerialNumberSupport, { toFile: true });

		for (let entityIDX = 0; entityIDX < Math.max(TotalEntities, 3); entityIDX++) {

			const FirmwareResponsePacket = this.setSpecificFeature([this.FeatureIDs.DeviceInfoID, 0x10, entityIDX], "Short", "Long", this.FeatureIDs.DeviceInfoID).data;
			const FirmwareType = FirmwareResponsePacket[1];
			const FirmwarePrefix = String.fromCharCode(...FirmwareResponsePacket.slice(2, 5));
			const FirmwareName = FirmwareResponsePacket[5];
			const FirmwareRevision = FirmwareResponsePacket[6];
			const FirmwareBuild = FirmwareResponsePacket.slice(7, 9);
			const ActiveFirmwareFlag = FirmwareResponsePacket[8];
			const TransportPID = FirmwareResponsePacket[10].toString(16) + FirmwareResponsePacket[11].toString(16);

			if (FirmwareType === 0) {
				device.log("Firmware Type: " + this.FirmwareType[FirmwareType], { toFile: true });
				device.log("Firmware Prefix: " + FirmwarePrefix + FirmwareName, { toFile: true });
				device.log("Firmware Revision: " + FirmwareRevision, { toFile: true });
				device.log("Firmware Build: " + FirmwareBuild, { toFile: true });
				device.log("Active Firmware Flag: " + ActiveFirmwareFlag, { toFile: true });
				device.log("Transport ID: " + TransportPID, { toFile: true });

				return TransportPID;
			}
		}

		return "0000";
	}
	/** Unused Device Serial Fetch. Device Unique Identifiers are Close Enough to Serials as Not All Devices Support Serials. */
	FetchDeviceSerialNumber() {
		const packet = [this.FeatureIDs.DeviceInfoID, 0x20];
		this.setShortFeature(packet);

		const SerialResponsePacket = this.getLongFeature().data;
		device.log(SerialResponsePacket);
	}
	/** Fetch Full Device Name. */
	FetchDeviceName() {

		const DeviceNameBytes = [];
		let ReadOffset = 0;
		const BytesReadPerPacket = 0x10;
		const NameLengthInBytes = this.FetchDeviceNameLength();

		if (NameLengthInBytes !== undefined) {
			while (ReadOffset < NameLengthInBytes) {
				const nameReturnPacket = this.setSpecificFeature([this.FeatureIDs.DeviceNameID, 0x10, ReadOffset], "Short", "Long", this.FeatureIDs.DeviceNameID).data;
				nameReturnPacket.shift();

				ReadOffset += BytesReadPerPacket;
				DeviceNameBytes.push(...nameReturnPacket);
			}
		}

		this.Config.DeviceName = String.fromCharCode(...DeviceNameBytes);
		device.log("Internal Device Name: " + this.Config.DeviceName, { toFile: true });
		device.setName(this.Config.DeviceName);

		return this.Config.DeviceName;
	}

	/** @private */
	FetchDeviceNameLength() {
		return this.setSpecificFeature([this.FeatureIDs.DeviceNameID, 0x00], "Short", "Long", this.FeatureIDs.DeviceNameID).data[1];
	}
	/** Fetch Friendly Device Name. */
	FetchFriendlyDeviceName() {

		const DeviceNameBytes = [];
		let ReadOffset = 0;
		const BytesReadPerPacket = 0x10;
		// Current Friendly Name Length is index 0
		const NameLengthInBytes = this.FetchFriendlyDeviceNameLength()[1];

		if (NameLengthInBytes !== undefined) {
			while (ReadOffset < NameLengthInBytes) {
				const nameReturnPacket = this.setSpecificFeature([this.FeatureIDs.FriendlyNameID, 0x10, ReadOffset], "Short", "Long", this.FeatureIDs.FriendlyNameID).data;

				nameReturnPacket.shift();

				ReadOffset += BytesReadPerPacket;
				DeviceNameBytes.push(...nameReturnPacket);
			}
		}

		this.Config.FriendlyName = String.fromCharCode(...DeviceNameBytes);
		device.log("Friendly Device Name: " + this.Config.FriendlyName, { toFile: true });

		return this.Config.FriendlyName;
	}
	/** Fetch How Long the Friendly Device Name is. */
	FetchFriendlyDeviceNameLength() {
		const data = this.setSpecificFeature([this.FeatureIDs.FriendlyNameID, 0x00], "Short", "Long", this.FeatureIDs.FriendlyNameID).data;

		this.getLongFeature().data;

		return data.slice(1, 4);
	}
	/** Fetch Default Friendly Device Name. */
	FetchDefaultFriendlyDeviceName() {

		const DeviceNameBytes = [];
		let ReadOffset = 0;
		const BytesReadPerPacket = 0x10;
		// Default Friendly Name Length is index 3
		const NameLengthInBytes = this.FetchFriendlyDeviceNameLength()[3];

		if (NameLengthInBytes !== undefined) {
			while (ReadOffset < NameLengthInBytes) {
				this.setShortFeature([this.FeatureIDs.FriendlyNameID, 0x20, ReadOffset]);

				const nameReturnPacket = this.getLongFeature().data;
				nameReturnPacket.shift();

				ReadOffset += BytesReadPerPacket;
				DeviceNameBytes.push(...nameReturnPacket);
			}
		}

		this.Config.DefaultFriendlyName = String.fromCharCode(...DeviceNameBytes);
		device.log("Default Friendly Device Name: " + this.Config.DefaultFriendlyName, { toFile: true });

		return this.Config.DefaultFriendlyName;
	}

	/** Overcomplicated Wrapper to Handle Unified vs Battery Voltage and Properly Reference Them to SignalRGB Values. */
	GetBatteryCharge() {
		if (this.FeatureIDs.UnifiedBatteryID !== 0) {
			const [BatteryPercentage, state, wirelessCharging] = this.GetUnifiedBatteryPercentage();

			switch (state) {
				case 0:
					battery.setBatteryState(1);
					break;
				case 1:
					if (wirelessCharging === 2) {
						battery.setBatteryState(5);
					} else {
						battery.setBatteryState(2);
					}
			}

			return BatteryPercentage;
		}

		if (this.FeatureIDs.BatteryVoltageID !== 0) {
			const [voltage, state] = this.GetBatteryVoltage();

			switch (state) {
				case 0:
					battery.setBatteryState(1);
					break;
				case 128:
					battery.setBatteryState(2);
					break;
				case 144:
					battery.setBatteryState(5);
					break;
			}

			return this.GetApproximateBatteryPercentage(voltage);
		}

		return 0;

	}
	/** Fetch Unified Battery Percentage. Returns Status and Battery Percentage. */
	GetUnifiedBatteryPercentage() {
		DetectInputs(); //run this directly before the Battery Check. The chances of this are now extremely low. We can fallback onto the handler of always checking instead of using device.clearReadBuffer.

		const result = this.setSpecificFeature(
			[this.FeatureIDs.UnifiedBatteryID, 0x10],
			"Short", "Long",
			this.FeatureIDs.UnifiedBatteryID, 5,
			"Unified Battree"
		);

		if (!result || !Array.isArray(result.data) || result.data.length < 5) {
			//device.log("Battery data invalid or incomplete:", JSON.stringify(result));
			return [undefined, undefined, undefined];
		}

		const BatteryArray = result.data;
		const BatteryPercentage = BatteryArray[1];
		const BatteryStatus = BatteryArray[3];
		const wirelessCharging = BatteryArray[4];

		device.log("Battery Percentage: " + BatteryPercentage);

		return [BatteryPercentage, BatteryStatus, wirelessCharging];
	}
	/** Fetch Battery Voltage That Needs Parsed With the Voltage Table. */
	GetBatteryVoltage() {
		DetectInputs();

		const BatteryArray = this.setSpecificFeature([this.FeatureIDs.BatteryVoltageID, 0x00, 0x10], "Long", "Long", this.FeatureIDs.BatteryVoltageID, 5, "Battree Voltage").data;

		if (BatteryArray[1] !== undefined && BatteryArray[2] !== undefined) {

			const BatteryVoltage = (BatteryArray[1] << 8) + BatteryArray[2];
			const BatteryStatus = BatteryArray[3];

			device.log("Battery Voltage: " + BatteryVoltage);

			return [BatteryVoltage, BatteryStatus];
		}

		return [-1, -1];
	}
	//This needs hit with a hammer.
	GetApproximateBatteryPercentage(BatteryVoltage) {
		const nearestVoltageBand = LogitechDevice.VoltageArray.reduce((prev, curr) => {
			return (Math.abs(curr - BatteryVoltage) < Math.abs(prev - BatteryVoltage) ? curr : prev);
		});
		device.log("Battery Percentage Remaining: " + LogitechDevice.PercentageLookupTable[nearestVoltageBand]);

		return LogitechDevice.PercentageLookupTable[nearestVoltageBand];
	}
	/** Set Device Polling Rate. */
	SetPollingRate(pollingrate) {
		const isProX2 = device.productId() === 0x40a9; // PRO X Superlight 2
		//WIRED:
		// 10 ff 0c 3c vaule 0000
		if (isProX2) {
			const map = {
				125: 0x00,
				250: 0x01,
				500: 0x02,
				1000: 0x03,
				2000: 0x04,
				4000: 0x05,
				8000: 0x06
			};

			const rate = parseInt(pollingrate);
			const value = map[rate] ?? 0x03;
			const connectionByte = Logitech.GetConnectionType() === "1" ? 0x01 : 0xff;
			const packet = [0x10, connectionByte, 0x0C, 0x3E, value, 0x00, 0x00];
			const hex = packet.map(b => b.toString(16).padStart(2, "0")).join(" ");
			device.log(`📦 Pollingrate-Packet (hex): ${hex}`);

			device.set_endpoint(
				this.GetDeviceEndpoint("interface"),
				this.MessageTypeEndpoints.ShortMessageEndpoint,
				0xff00
			);
			device.write(packet, packet.length);
			device.log(`⚡ Pollingrate gesetzt auf ${rate}Hz`);

			// Optional: Wenn du ReadPollingRate() definiert hast
			if (typeof ReadPollingRate === "function") {
				ReadPollingRate();
			}

			return;
		}

		// 🔁 Standard für alle anderen Geräte
		this.setShortFeature(
			[this.FeatureIDs.PollingRateID, 0x20, 1000 / pollingrate],
			false,
			false,
			"Polling Rate Set"
		);
		device.log(`📶 Standard Pollingrate gesetzt: ${pollingrate}Hz`);
	}
	/** Stop Burning Flash Memory. */
	SetDirectMode(OnboardState) {
		if (this.UsesHeroProtocol()) {
			//nvram, set, all sw control, effect sync notif-no user activity timeout
			this.setShortFeature([this.FeatureIDs.RGB8071ID, 0x50, 0x01, 0x03, 0x05], false, false, "SW Control of modes");

			if (this.FeatureIDs.PerKeyLightingV2ID === 0) {
				Logitech.setLongFeature([Logitech.FeatureIDs.RGB8071ID, 0x30, 0x01, 0x00, 0x08, 0x04, 0x07], false, "Hero Packet 2");

				Logitech.setShortFeature([Logitech.FeatureIDs.RGB8071ID, 0x20, 0x00, 0x03]);

				Logitech.setShortFeature([Logitech.FeatureIDs.RGB8071ID, 0x30, 0x00, 0x00, 0x08]);
			}

			return;
		}

		this.setShortFeature([this.FeatureIDs.RGB8070ID, 0x80, 0x01, 0x01], false, false, "Onboard Lighting Control."); //Standard Device LEDs

		this.setShortFeature([this.FeatureIDs.LEDControlID, 0x30, OnboardState ? 0x00 : 0x01], false, false, "Onboard DPI Light Control."); //DPI LEDs counts on 8070 Devices.
	}
	/** Handler to Write Pretty Lights to Device. */
	SendLighting(RGBData) {
		if (this.UsesPerLedLightingV2()) {
			this.SendPerKeyLightingPacket(RGBData);
		} else {
			this.SendSingleZoneLighting(RGBData);
		}
	}
	/** Write Pretty Lights to Single Zone Send Devices. */
	SendSingleZoneLighting(rgbdata) {
		const loops = (rgbdata.length / 3);

		for (let Zones = 0; Zones < loops; Zones++) {

			const zoneData = rgbdata.splice(0, 3);
			const packet = [(this.UsesHeroProtocol() ? this.FeatureIDs.RGB8071ID : this.FeatureIDs.RGB8070ID), (this.UsesHeroProtocol() ? 0x10 : 0x30), Zones, 0x01, zoneData[0], zoneData[1], zoneData[2], (this.UsesHeroProtocol() ? 0x00 : 0x02)];

			if (this.DeviceID === "4067" || this.DeviceID === "4070" || this.UsesHeroProtocol()) {
				packet[14] = 0x01;
				//On today's list of "Wow this protocol is cool."
				//For Hero, we wacking bitflags.
				//nonhero it's set to nonvolatile and volatile which MAKES NO SENSE.
			}

			this.setLongFeature(packet, true, "RGB Send", true);
			device.pause(5);
		}

		if (this.DeviceID === "4079" || this.DeviceID === "405d") {
			this.Apply();
		}
	}
	/** Write Pretty Lights to Devices That Send Multiple LEDs Per Packet. */
	SendPerKeyLightingPacket(RGBData) {
		while (RGBData.length > 0) {
			const DataLength = Math.min(16, RGBData.length);
			this.setLongFeature([this.FeatureIDs.PerKeyLightingV2ID, 0x10].concat(RGBData.splice(0, DataLength)), true, "PerKey Send", true);
		}

		this.PerKeyLightingApply();
	}
	/** Apply PerLED Lighting. */
	PerKeyLightingApply() {
		this.setLongFeature([this.FeatureIDs.PerKeyLightingV2ID, 0x70], true, "Perkey RGB Apply", true);
	}
	/** Packet Apply For Devices That Require It. */
	Apply() {
		this.setLongFeature([0x00, 0x20, 0x01], true, "RGB Apply", true);
		//This packet literally makes zero sense. This is off of feature id 0 which is root.
		//ROOT DOESN'T EVEN HAVE A 0x20 FUNCTION.
	}
	/** Get Lightning Dim Minutes */
	GetLightingDimMinutes() {
		const response = this.setSpecificFeature([this.FeatureIDs.RGB8071ID, 0x70, 0x00], "Short", "Long", this.FeatureIDs.RGB8071ID, 10).data;
		console.log(response);

		const response2 = this.setSpecificFeature([this.FeatureIDs.RGB8071ID, 0x50, 0x00], "Short", "Long", this.FeatureIDs.RGB8071ID, 10).data;
		console.log(response2);

		const dimMinutes = BinaryUtils.ReadInt16BigEndian(response.slice(4, 6)) / 60;
		const timeoutMinutes = (BinaryUtils.ReadInt16BigEndian(response.slice(6, 8))) / 60;

		device.log("Dim Minutes: " + dimMinutes);
		device.log("Timeout Minutes: " + timeoutMinutes);

		return [dimMinutes, timeoutMinutes];
	}
	/** Set Lightning Dim Minutes */
	SetLightingDimMinutes() {

		const dimMinutes = BinaryUtils.WriteInt16BigEndian(dimTimeoutLength === "Never" ? 0 : dimTimeoutLength * 60);
		const timeoutMinutes = BinaryUtils.WriteInt16BigEndian(idleTimeoutLength === "Never" ? 0 : idleTimeoutLength * 60 + 30);

		// debug
		device.log("Dim Minutes: " + dimMinutes);
		device.log("Timeout Minutes: " + timeoutMinutes);

		//manageRgbPowerModeConfig
		this.setShortFeature([this.FeatureIDs.RGB8071ID, 0x70, 0x01, 0x00, 0x00, dimMinutes[0], dimMinutes[1], timeoutMinutes[0], timeoutMinutes[1]], false, false, "Set Timeout Minutes");
		this.GetLightingDimMinutes();

		//manageSwControl
		if (dimTimeoutLength !== "Never") {
			device.log("Dimming Enabled");
			// Set user activity notification
			this.setShortFeature([this.FeatureIDs.RGB8071ID, 0x50, 0x01, 0x03, 0x03], false, false, "SW Control of modes");
		} else {
			device.log("Dimming Disabled.");
			// Disable user activity notification
			this.setShortFeature([this.FeatureIDs.RGB8071ID, 0x50, 0x01, 0x03, 0x05], false, false, "SW Control of modes");
		}
	}
}

const Logitech = new LogitechProtocol();

export class LogitechMouseDevice {
	constructor() {
		this.Config = {
			/** Variable for defining if a mouse has DPI Lights. */
			hasDPILights: false,
			enabledDPILights: false,
			DPILightAlwaysOn: false,
			/** Variable for defining if a mouse has a sniper button. */
			hasSniperButton: false
		};
	}

	getEnabledDPILights() { return this.Config.enabledDPILights; }
	setEnabledDPILights(enabledDPILights) { this.Config.enabledDPILights = enabledDPILights; }

	getDPILightAlwaysOn() { return this.Config.DPILightAlwaysOn; }
	setDPILightAlwaysOn(DPILightAlwaysOn) { this.Config.DPILightAlwaysOn = DPILightAlwaysOn; }

	getHasDPILights() { return this.Config.hasDPILights; }
	setHasDPILights(hasDPILights) { this.Config.hasDPILights = hasDPILights; }

	getHasSniperButton() { return this.Config.hasSniperButton; }
	setHasSniperButton(hasSniperButton) { this.Config.hasSniperButton = hasSniperButton; }

	/** Configure Initial Mouse settings. */
	configureMouseSettings() {
		device.addFeature("mouse");

		if (this.getHasSniperButton()) {
			DPIHandler.addSniperProperty();
		}

		DPIHandler.setMinDpi(200);
		DPIHandler.setMaxDpi(Logitech.GetDeviceMaxDPI());
		DPIHandler.setUpdateCallback((dpi, stage) => { return this.setDpi(dpi, stage); });
		DPIHandler.addProperties();
		DPIHandler.setRollover(dpiRollover);

		if (settingControl) {
			this.SetOnBoardState(OnboardState);
		}

		if (this.getHasDPILights()) {
			device.addProperty({ "property": "dpiLight", "group": "mouse", "label": "DPI Light Always On", "type": "boolean", "default": "true" });
		}

		if (this.getHasDPILights()) {
			this.SetDpiLightAlwaysOn(dpiLight);
		}

		if (settingControl && !OnboardState) {
			DPIHandler.setActiveControl(settingControl);
			DPIHandler.update();
		} else {
			this.SetDPILights(3); //Fallback to set DPILights to full
		}

		// Superstrike: push the SignalRGB-side Trigger Force / Click Haptic values
		// to the mouse so the UI and firmware state stay in sync after init.
		// Without this the UI shows the SignalRGB defaults while the mouse keeps
		// whatever G HUB last wrote — they only resync after the user touches a
		// dropdown.
		const productId = device.productId();
		if (productId === 0xC54D || productId === 0xC09B || productId === 0xC0A8) {
			this.setTriggerSwitchState();
		}
	}

	/** Get Current LOD for new GEN Mouse */
	GetLODByte(lodStr) {
		switch (lodStr) {
			case "Low": return 0x01;
			case "High": return 0x03;
			default: return 0x02; // medium
		}
	}

	/** Set Gaming Mode for PRO X 2 Superlight */
	setGamingMode() {
		if (Logitech.Config.DeviceName.includes("PRO X 2")) {
			const game = device.getProperty(`gameMode`);
			const modeMap = {
				"On":   0x03,
				"Off":  0x05,
				"Auto": 0x01
			};

			const modeByte = modeMap[game.value] ?? 0x03;
			const packet = [
				0x11, 0x01, 0x0A, 0x1A, 0x00,
				modeByte, 0x00, 0x07,
				...new Array(11).fill(0x00)
			];
			device.set_endpoint(
				Logitech.GetDeviceEndpoint("interface"),
				Logitech.MessageTypeEndpoints.LongMessageEndpoint,
				0xff00
			);
			device.write(packet, packet.length);
			device.pause(50);
			device.log(`Gaming Mode set to ${game.value.toUpperCase()}`);
		}
	}
	/** Set BHOP Mode with delay in milliseconds (0 to 1000ms) */
	setBHOPMode() {
		if (Logitech.Config.DeviceName.includes("PRO X 2")) {
			const bhob = device.getProperty(`bhopMode`);
			let delayByte = 0x00;
			let delay = 0;
			const isOff = (typeof bhob.value === "string" && bhob.value.toLowerCase() === "off");

			if (isOff) {
				delayByte = 0x00;
				delay = 0;
			} else {
				const parsed = parseInt(bhob.value, 10);
				delay = Math.min(1000, Math.max(0, parsed));
				delayByte = Math.floor(delay / 10);
			}

			// Connection-mode-aware addressing.
			// Wireless: device index 0x01, SWID 'b' for ON, 'c' for OFF (matches captured G HUB pattern).
			// Wired:    device index 0xFF, SWID 'e' for both ON and OFF (matches cable-init capture).
			const devIdx = Logitech.GetConnectionMode();
			const isWired = devIdx === Logitech.ConnectionType["Wired"];
			let funcByte;
			if (isWired) {
				funcByte = 0x2E;
			} else {
				funcByte = isOff ? 0x2C : 0x2B;
			}

			const packet = [0x10, devIdx, 0x0B, funcByte, delayByte, 0x00, 0x00];
			device.set_endpoint(
				Logitech.GetDeviceEndpoint("interface"),
				Logitech.MessageTypeEndpoints.ShortMessageEndpoint,
				0xff00
			);
			device.write(packet, packet.length);
			device.pause(50);
			device.log(`BHOP Mode set to ${delay}ms (${isWired ? "wired" : "wireless"})`);
		}
	}
	/** Set Trigger Force + Click Haptic for the Superstrike inductive switches.
	 *  Both values share the same firmware register, so we always send both —
	 *  if only one was changed the other gets re-applied with its current value.
	 *  G HUB pushes the same packet twice with side=0 and side=1 (left + right).
	 *  Captured encoding: 11 01 0c 1b [SIDE] [PRESSURE] 08 [HAPTIC] 00 ...
	 *    SIDE     = 0x00 (left) | 0x01 (right)
	 *    PRESSURE = Level (1..10) * 0x04   → 0x04..0x28
	 *    HAPTIC   = Off=0x00, Level1..5 = 0x04..0x14 in steps of 4
	 */
	setTriggerSwitchState() {
		// Superstrike-only feature (inductive switches).
		// PIDs: 0xC54D Lightspeed dongle, 0xC0A8 wired direct USB.
		// (0xC09B was a guess from existing plugin code that turned out to be a different device.)
		const productId = device.productId();
		if (productId !== 0xC54D && productId !== 0xC09B && productId !== 0xC0A8) return;

		const tfProp = device.getProperty(`triggerForce`);
		const chProp = device.getProperty(`clickHaptic`);
		if (!tfProp || !chProp) return;

		const tfMatch = /Level\s*(\d+)/i.exec(tfProp.value);
		const tfLevel = tfMatch ? Math.max(1, Math.min(10, parseInt(tfMatch[1], 10))) : 5;
		const pressureByte = tfLevel * 0x04;

		const hapticMap = { "Off": 0x00, "Level 1": 0x04, "Level 2": 0x08, "Level 3": 0x0C, "Level 4": 0x10, "Level 5": 0x14 };
		const hapticByte = hapticMap[chProp.value] ?? 0x00;

		// Connection-mode-aware addressing. SWID matches connection: 'b' wireless, 'e' wired.
		const devIdx = Logitech.GetConnectionMode();
		const isWired = devIdx === Logitech.ConnectionType["Wired"];
		const funcByte = isWired ? 0x1E : 0x1B;

		device.set_endpoint(
			Logitech.GetDeviceEndpoint("interface"),
			Logitech.MessageTypeEndpoints.LongMessageEndpoint,
			0xff00
		);

		for (const side of [0x00, 0x01]) {
			const packet = [
				0x11, devIdx, 0x0C, funcByte,
				side, pressureByte, 0x08, hapticByte,
				...new Array(12).fill(0x00)
			];
			device.write(packet, packet.length);
			device.pause(20);
		}
		device.log(`Trigger Force = Lvl ${tfLevel}, Click Haptic = ${chProp.value} (${isWired ? "wired" : "wireless"})`);
	}
	/** Set the Current Software DPI based on a callback from the DPIHandler. */
	setDpi(dpi, stage = 0) {
		const productId = device.productId();
		const isSuperstrike = productId === 0xC54D || productId === 0xC09B || productId === 0xC0A8;

		if (isSuperstrike) {
			// Captured G HUB encoding for the Superstrike. Three packets:
			//   1. set DPI value (function 6, X+Y as 16-bit BE, trailing 0x02)
			//   2. save to stage (function 7 with stage index 1..5)
			//   3. apply trigger (short packet, function 3)
			//
			// Connection-mode-aware: SWID 'b' on wireless (function bytes 0x6B/0x7B/0x3B),
			// SWID 'e' on wired (0x6E/0x7E/0x3E). Device index switches between 0x01 and 0xFF.
			const hi = (dpi >> 8) & 0xFF;
			const lo =  dpi       & 0xFF;
			const stageByte = (stage >= 1 && stage <= 5) ? stage : 0x01;

			const devIdx = Logitech.GetConnectionMode();
			const isWired = devIdx === Logitech.ConnectionType["Wired"];
			const f6 = isWired ? 0x6E : 0x6B;
			const f7 = isWired ? 0x7E : 0x7B;
			const f3 = isWired ? 0x3E : 0x3B;

			device.set_endpoint(
				Logitech.GetDeviceEndpoint("interface"),
				Logitech.MessageTypeEndpoints.LongMessageEndpoint,
				0xff00
			);
			device.write([
				0x11, devIdx, 0x09, f6, 0x00,
				hi, lo, hi, lo, 0x02,
				...new Array(10).fill(0x00)
			], 20);
			device.pause(20);
			device.write([
				0x11, devIdx, 0x09, f7, 0x00,
				stageByte,
				...new Array(13).fill(0x00)
			], 20);
			device.pause(20);

			device.set_endpoint(
				Logitech.GetDeviceEndpoint("interface"),
				Logitech.MessageTypeEndpoints.ShortMessageEndpoint,
				0xff00
			);
			device.write([0x10, devIdx, 0x0D, f3, 0x05, 0x00, 0x00], 7);
			device.pause(20);

			device.log(`DPI: ${dpi} set to Stage: ${stageByte} (${isWired ? "wired" : "wireless"})`);
			return;
		}

		if (Logitech.Config.DeviceName.includes("PRO X 2")) {
			const dpiLE = [(dpi >> 8) & 0xFF, dpi & 0xFF];

			const lod = device.getProperty(`lodMode`);
			const lodbyte = this.GetLODByte(lod.value);

			const dpiPacket = [
				0x11, 0x01, 0x09, 0x6E, 0x00,
				dpiLE[0], dpiLE[1],
				dpiLE[0], dpiLE[1],
				lodbyte,
				...new Array(10).fill(0x00)
			];

			device.write(dpiPacket, dpiPacket.length);
			device.pause(50);

			const savePacket = [
				0x11, 0x01, 0x09, 0x7E, 0x00,
				stage,
				...new Array(13).fill(0x00)
			];
			device.write(savePacket, savePacket.length);
			device.log(`DPI: ${dpi}, LOD: ${lod.value} set to Stage: ${stage}`);
		} else {
			// ➤ Default-Logik für alle anderen Geräte
			Logitech.setLongFeature(
				[Logitech.FeatureIDs.DPIID, 0x30, 0x00, Math.floor(dpi / 256), dpi % 256, stage],
				true,
				"DPI",
				true
			);
			device.log(`DPI [default] Set to : ${stage}`);
		}

		this.SetDPILights(stage);
	}
	/** Set the Number of DPI Lights That are On For a Mouse. */
	SetDPILights(stage) {
		if (!this.Config.hasDPILights) {
			return;
		}

		if (Logitech.UsesHeroProtocol()) {
			Logitech.setShortFeature([Logitech.FeatureIDs.RGB8071ID, 0x20, 0x00, stage], false, false, "Hero DPI Lights", true);
		} else {
			Logitech.setLongFeature([Logitech.FeatureIDs.LEDControlID, 0x50, 0x01, 0x00, 0x02, 0x00, stage], false, "DPI Lights", true); //Setting State!
		}

		if (this.getDPILightAlwaysOn() === false) {
			this.setEnabledDPILights(true);
			savedDPITimer = Date.now();
		}

		device.log("DPI Lights set to stage: " + stage);
	}
	/** Function to determine if the DPI Light is always on or turns off after a few seconds. */
	SetDpiLightAlwaysOn(DPILight) {
		if (!this.getHasDPILights()) {
			device.log("DPI Lights? What DPI Lights?", { toFile: true });

			return;
		}

		this.setDPILightAlwaysOn(DPILight);
	}
	/** Enable or Disable Software Button Listener. */
	SetButtonSpy(OnboardState) {
		Logitech.setShortFeature([Logitech.FeatureIDs.ButtonSpyID, 0x10, 0x00, 0x00, 0x00], false, false, "Button Spy Enable"); //Enable

		if (OnboardState) {
			Logitech.setShortFeature([Logitech.FeatureIDs.ButtonSpyID, 0x20], false, false, "Button Spy Release"); //Release
			device.log("Button Spy Released.");
		} else {
			Logitech.setLongFeature([Logitech.FeatureIDs.ButtonSpyID, 0x40, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x08, 0x0a, 0x0b, 0x0c], false, "Button Spy Assignment"); //Log all the buttons!
			device.log("Button Spy Attached.");
		}
	}
	/** Enable or Disable Hardware Keybinds. Goes hand in hand with ButtonSpy. */
	SetOnBoardState(OnboardState) {
		Logitech.setShortFeature([Logitech.FeatureIDs.OnboardProfilesID, 0x10, (OnboardState ? Logitech.DeviceModes.HardwareMode : Logitech.DeviceModes.SoftwareMode)], false, false, "Onboard State");
		device.log(`Onboard State Set to ${OnboardState}.`, { toFile: true });
		this.SetButtonSpy(OnboardState);
	}

	MapPhysicalButtonIDToName(buttonId) { return LogitechDevice.PhysicalButtonIds[buttonId]; }
	GetMouseButtons(physicalButton) { return LogitechDevice.ButtonMaps[Logitech.GetMouseBodyType()][physicalButton]; }
	MapButtonNameToSignalRGBValue(ButtonName) { return LogitechDevice.buttonMapDict[ButtonName]; }
}

const LogitechMouse = new LogitechMouseDevice();

class LogitechKeyboardDevice {
	constructor() {

	}

	configureKeyboardSettings() {
		//This will have more settings for G and M Key configs in the future
	}

	GKeySetup(enable = true) {
		Logitech.setShortFeature([Logitech.FeatureIDs.GKeyID, 0x00]); //Info
		Logitech.setShortFeature([Logitech.FeatureIDs.GKeyID, 0x20, enable]); //Software Enable Flag for GKeys and Mkeys
	}

	MKeySetup() {
		Logitech.setShortFeature([Logitech.FeatureIDs.MKeyID, 0x00]); //Info
		Logitech.setShortFeature([Logitech.FeatureIDs.MKeyID, 0x10]); //Led Number Flag in binary. I don't remember what that means.
	}
}

const LogitechKeyboard = new LogitechKeyboardDevice();

class LogitechPowerplayDevice {
	constructor() {
		this.Config = {
			hasPowerplay: false,
		};

		this.Powerplay_Mat =
		{
			mapping: [0],
			positioning: [[0, 0]],
			displayName: "PowerPlay MousePad",
			ledCount: 1,
			width: 3,
			height: 3,
			image: "https://assets.signalrgb.com/devices/brands/logitech/mousepads/powerplay.png"
		};
	}

	getPowerplay() { return this.Config.hasPowerplay; }
	setPowerplay(Powerplay) { this.Config.hasPowerplay = Powerplay; }

	Powerplayinit() { //Some may consider the lack of polish on this function jank. I consider those people correct. I also consider this function working and I'm scared to touch it.
		if (device.productId() !== 0xC53A) {
			device.log("No Powerplay Here!");

			return;
		}

		this.setPowerplay(true);

		device.set_endpoint(2, 0x0001, 0xff00);

		device.write([0x10, 0x07, 0x0b, 0x10], 7); //RGB Info iirc?

		device.set_endpoint(2, 0x0002, 0xff00);

		device.write([0x11, 0x07, 0x0b, 0x20], 20); //RGB

		device.write([0x11, 0x07, 0x0b, 0x20, 0x00, 0x01], 20);//RGB Registers?

		device.write([0x11, 0x07, 0x0b, 0x20, 0x00, 0x02], 20);//RGB

		device.set_endpoint(2, 0x0001, 0xff00);

		device.write([0x10, 0x07, 0x0b, 0xCE], 7);//RGB Also woah 0xC is super far out of normal bounds

		device.write([0x10, 0x07, 0x0b, 0x70], 7);//RGB Power junk

		device.write([0x10, 0x07, 0x0b, 0x80, 0x01, 0x01], 7);//RGB Enable!

		device.write([0x10, 0x07, 0x0b, 0xCE], 7);//RGB Also woah 0xC is super far out of normal bounds

		device.write([0x10, 0x07, 0x0b, 0x40, 0x00, 0x01], 7);

		device.set_endpoint(2, 0x0002, 0xff00);
		device.write([0x11, 0x07, 0x0b, 0x30, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02], 20);

		device.createSubdevice("PowerPlayMat");
		device.setSubdeviceName("PowerPlayMat", `${this.Powerplay_Mat.displayName}`);
		device.setSubdeviceImageUrl("PowerPlayMat", this.Powerplay_Mat.image);
		device.setSubdeviceSize("PowerPlayMat", this.Powerplay_Mat.width, this.Powerplay_Mat.height);

		device.pause(1000); //wait a second for device to reinit in software mode
	}
}

const LogitechPowerplay = new LogitechPowerplayDevice();

export class LogitechDongleDevice {
	constructor() {
		this.V1ErrorCodes = {
			0x00: "Success",
			0x01: "Invalid Command",
			0x02: "Invalid Address",
			0x03: "Invalid Value",
			0x04: "Connection Failed",
			0x05: "Too Many Connected Devices",
			0x06: "Already Exists (Receiver)",
			0x07: "Busy (Receiver)",
			0x08: "Unknown Device (Receiver)",
			0x09: "Resource Error (Receiver)",
			0x0A: "Request Unavailable",
			0x0B: "Invalid Parameter Value",
			0x0C: "Incorrect Pin Code"
		};
	}

	SetHidppNotifications(enabled) {
		const returnPacket = Logitech.setShortFeature([0x80, 0x00, 0x00, enabled], false, true).data;

		const errorCode = returnPacket[2];

		if (errorCode === 0x01) {
			device.log("Device does not support HIDPPV1 Notifications. Presuming Wired/Singlepoint.");
			Logitech.SetConnectionMode("Wired");

			return 0;
		}

		Logitech.SetConnectionMode("Wireless");

		return 1;
	}

	PingDevice() {
		device.log("Pinging Device...");
		device.pause(50);

		const wirelessDevice = this.SetHidppNotifications(true);

		if (wirelessDevice === 0) {
			return true;
		}

		const returndata = Logitech.setShortFeature([0x80, 0x02, 0x02, 0x00], false, true).data; //Fake reconnect

		const TransportPID = returndata[3].toString(16) + returndata[2].toString(16);

		console.log("Transport PID: " + TransportPID);
		console.log("Device model: " + LogitechDevice.DeviceIDs[TransportPID]);

		if (returndata[0] === 0 && returndata[1] === 0 && returndata[2] === 0x00 && returndata[3] === 0x00) { //Do you like edge cases? I don't. They are the reason for this statement's existence.
			Logitech.SetConnectionMode("Wired");

			return true;
		}

		// Prevent extra packets from appearing randomly.
		this.SetHidppNotifications(false);

		if (LogitechDevice.DeviceIDs.hasOwnProperty(TransportPID)) {

			device.pause(100);

			return true;
		}

		return false;
	}
}

const LogitechDongle = new LogitechDongleDevice();

export default class DpiController {
	constructor() {
		this.currentStageIdx = 1;
		const hasDpiButton = LogitechMouse.getHasDPILights() || LogitechMouse.getHasSniperButton();
		if(hasDpiButton){
			this.maxSelectedableStage = 5;
			this.maxStageIdx = 5; //Default to 5 as it's most common if not defined
		}else{
			this.maxSelectedableStage = 1;
			this.maxStageIdx = 1;
		}
	
		this.sniperStageIdx = 6;

		this.updateCallback = (dpi, stage) => { this.log("No Set DPI Callback given. DPI Handler cannot function!"); dpi; stage; };

		this.logCallback = (message) => { console.log(message); };

		this.sniperMode = false;
		this.enabled = false;
		this.dpiRollover = false;
		this.dpiMap = new Map();
		this.maxDpi = 25600;
		this.minDpi = 200;
	}
	addProperties() {
		device.addProperty({ "property": "settingControl", "group": "mouse", "label": "Enable Setting Control", description: "SignalRGB will not attempt to set mouse settings like DPI and Polling Rate while this is disabled", "type": "boolean", "default": "false", "order": 1 });
		device.addProperty({ "property": "dpiStages", "group": "mouse", "label": "Number of DPI Stages", description: "Sets the number of active DPI stages to cycle though", "step": "1", "type": "number", "min": "1", "max": this.maxSelectedableStage, "default": this.maxStageIdx, "order": 1, "live": "false" });
		device.addProperty({ "property": "dpiRollover", "group": "mouse", "label": "DPI Stage Rollover", description: "Allows DPI Stages to loop in a circle, going from last stage to first one on button press", "type": "boolean", "default": "false", "order": 1 });

		try {
			// @ts-ignore
			this.maxStageIdx = dpiStages;
		} catch (e) {
			this.log("Skipping setting of user selected max stage count. Property is undefined");
		}

		this.rebuildUserProperties();
	}
	addSniperProperty() {
		device.addProperty({ "property": `dpi${this.sniperStageIdx}`, "group": "mouse", "label": "Sniper Button DPI", "step": "50", "type": "number", "min": this.minDpi, "max": this.maxDpi, "default": "400", "order": 3, "live": "false" });
		// eslint-disable-next-line no-eval
		this.dpiMap.set(6, () => { return eval(`dpi${6}`); });
	}

	getCurrentStage() { return this.currentStageIdx; }
	getMaxStage() { return this.maxStageIdx; }
	getSniperIdx() { return this.sniperStageIdx; }

	getSniperMode() { return this.sniperMode; }
	setRollover(enabled) { this.dpiRollover = enabled; }

	setMaxStageCount(count) {
		this.maxStageIdx = count;
		this.rebuildUserProperties();
	}

	setMinDpi(minDpi) { this.minDpi = minDpi; this.updateDpiRange(); }
	setMaxDpi(maxDpi) { this.maxDpi = maxDpi; this.updateDpiRange(); }
	setUpdateCallback(callback) { this.updateCallback = callback; }
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

		return dpi;
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
			this.updateCallback(dpi, stage);
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
			if (+stage + 1 === this.sniperStageIdx) {
				continue;
			}

			if (stage >= this.maxStageIdx) {
				this.log(`Removing Stage: ${+stage + 1}`);
				device.removeProperty(`dpi${+stage + 1}`);
				this.dpiMap.delete(+stage + 1);
			}
		}
		// Add new Stages
		const stages = Array.from(this.dpiMap.keys());

		for (let i = 1; i <= this.maxStageIdx; i++) {
			if (stages.includes(i)) {
				continue;
			}

			this.log(`Adding Stage: ${i}`);
			device.addProperty({ "property": `dpi${i}`, "group": "mouse", "label": `DPI ${i}`, "step": "50", "type": "number", "min": this.minDpi, "max": this.maxDpi, "default": 800 + (400 * i), "order": 2, "live": "false" });
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
		this.callback = (bitIdx, state) => { throw new Error("BitArray(): No Callback Available?"); };
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
		if (state) {
			this.set(bitIdx);
		} else {
			this.clear(bitIdx);
		}
	}

	/** @param {bitArrayCallback} callback */
	setCallback(callback) {
		this.callback = callback;
	}

	/** @param {number[]} newArray */
	update(newArray) {
		// Check Every Byte
		for (let byteIdx = 0; byteIdx < newArray.length; byteIdx++) {
			const value = newArray[byteIdx] ?? 0;

			if (this.bitArray[byteIdx] === value) {
				continue;
			}

			// Check Every bit of every changed Byte
			for (let bit = 0; bit < this.byteWidth; bit++) {
				const isPressed = Boolean((value) & (1 << (bit)));

				const bitIdx = byteIdx * 8 + bit;

				// Skip if the new bit state matches the old bit state
				if (isPressed === this.get(bitIdx)) {
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
const macroInputArray = new BitArray(3);

export class LogitechExtras { //class to store all of the extra unused stuff
	constructor() {

	}

	/** Fetch the Number of Feature ID's a Device Has. */
	FetchFeatureCount() {
		const count = Logitech.setLongFeature([0x01, 0x00]).data[1];
		device.log(`Supported Feature Count: ${count}`);

		return count;
	}

	/** Fetch and Dump All Supported Feature Pages. */
	FetchSupportedFeatures() {
		device.log(`Dumping All Supported Feature Pages`);
		device.log(`------------------------`);

		const FeatureCount = this.FetchFeatureCount();

		for (let i = 0; i < FeatureCount; i++) {
			const packet = [0x01, 0x10, i];
			const ReturnData = Logitech.setLongFeature(packet).data;
			const FeaturePage = (ReturnData[0] << 8) | ReturnData[1];
			const FeatureType = ReturnData[2];
			const FeatureVersion = ReturnData[3];

			const Obsolete = FeatureType & (1 << 7);
			const Hidden = FeatureType & (1 << 6);
			const Engineering = FeatureType & (1 << 5);
			const Manufacturing = FeatureType & (1 << 4);

			let message = `Supported Feature Page: 0x${FeaturePage.toString(16)}, Version: ${FeatureVersion}`;

			if (Obsolete) {
				message += ", Obsolete";
			}

			if (Hidden) {
				message += ", Hidden";
			}

			device.log(message);
		}
	}

	/** Fetch What Kind of HIDPP Device We're Talking To. */
	FetchDeviceType() {

		const deviceTypeId = Logitech.setSpecificFeature([Logitech.FeatureIDs.DeviceNameID, 0x20], "Short", "Long", Logitech.FeatureIDs.DeviceNameID).data[1];

		device.log("Detected Device Type: " + deviceTypeId, { toFile: true });
		device.log("Device Type: " + Logitech.GetDeviceType(), { toFile: true }); //

		return deviceTypeId;
	}

	SetDeviceResetMode() {
		Logitech.setShortFeature([Logitech.FeatureIDs.ResetID, 0x10], false, false, "Reset");
		device.pause(1500);
		Logitech.clearLongReadBuffer();
		Logitech.clearShortReadBuffer();
		device.log("Device Reset.", { toFile: true });
	}

	//Dongle Functions ------------------------------------------------------------------------------------------------------------------------------------------------
	SetPairingMode() {
		const packet = [0x80, 0xb2, 0x03, 0x01]; //Additional arguments are supported, device number, and timeout for pairing. This could be useful if I wanted to add unifying support as a weekend project lol.
		//Sidenote for the lock and unlock functions. Lightspeed dongles don't have the ability to lock or unlock. We can only force a clear of paired devices as they have 1 register. Lock/Unlock keeps current pairing and allows for more devices.
		Logitech.setShortFeature(packet, false, true).data; //Drop the lock and d/c any connected device.
		device.log("Device D/C'd"); //This should set a flag for pairing mode, so that we can flip into device connect check mode. When we grab a new device, pop our init process. Should be seamless.
		this.GetPostPairingSetup();
	}

	GetPostPairingSetup() {//This function could walk us into a deadlock. We're adding a timeout, otherwise the plugin could get stuck if we don't catch the init function.
		let devicePaired = false; //Dongle doesn't have a way to recover from a failed pair it seems like. Ghub is the same way. Just need to keep it in mind.
		let pairingTime = 0;
		device.set_endpoint(2, 0x0001, 0xff00);

		do {
			const response = device.read([0x00], 7, 10);
			const reconnectMessage = [17, 1, 4, 0, 1, 1, 1]; //Full reconnect Message
			pairingTime++;

			if (response[0] !== 0x00) {
				device.log(response); //Leave this here in case a device does something weird.
			}


			if (Logitech.CompareArrays(response, reconnectMessage)) {

				devicePaired = true;
				device.log("New Device Paired. Running initialization process.");
			}

			if (pairingTime > 5000) {//If we're locked up for a full minute, we can presume failure.
				device.log("Device Pairing Failed, or Connect Message Failed.");
				devicePaired = true; //force to true. The init function will catch us anyway if we don't have a paired device.
			}
		}
		while (devicePaired === false);

		//This function holds up init until we get a good result or timeout. No further action needed. I could add a return for logging good values tho.
	}
}

export class LogitechResponse {
	constructor(packet) {
		this.featureId = packet[2];
		this.error = packet[5];
		this.data = packet.splice(3);
	}

	getFeatureId() {
		return this.featureId;
	}

	getError() {
		return this.error;
	}

	getReturnData() {
		return this.data;
	}
}

class BinaryUtils {
	static WriteInt16LittleEndian(value) {
		return [value & 0xFF, (value >> 8) & 0xFF];
	}
	static WriteInt16BigEndian(value) {
		return this.WriteInt16LittleEndian(value).reverse();
	}
	static ReadInt16LittleEndian(array) {
		return (array[0] & 0xFF) | (array[1] & 0xFF) << 8;
	}
	static ReadInt16BigEndian(array) {
		return this.ReadInt16LittleEndian(array.slice(0, 2).reverse());
	}
	static ReadInt32LittleEndian(array) {
		return (array[0] & 0xFF) | ((array[1] << 8) & 0xFF00) | ((array[2] << 16) & 0xFF0000) | ((array[3] << 24) & 0xFF000000);
	}
	static ReadInt32BigEndian(array) {
		if (array.length < 4) {
			array.push(...new Array(4 - array.length).fill(0));
		}

		return this.ReadInt32LittleEndian(array.slice(0, 4).reverse());
	}
	static WriteInt32LittleEndian(value) {
		return [value & 0xFF, ((value >> 8) & 0xFF), ((value >> 16) & 0xFF), ((value >> 24) & 0xFF)];
	}
	static WriteInt32BigEndian(value) {
		return this.WriteInt32LittleEndian(value).reverse();
	}
}
