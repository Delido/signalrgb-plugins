export function Name() { return "Corsair Headset Device"; }
export function VendorId() { return 0x1B1C; }
export function ProductId() { return Object.keys(CORSAIRdeviceLibrary.PIDLibrary); }
export function Publisher() { return "WhirlwindFx"; }
export function Documentation(){ return "troubleshooting/corsair"; }
export function Size() { return [1, 1]; }
export function DeviceType(){return "headphones";}
export function Validate(endpoint) { return endpoint.interface === 3 || endpoint.interface === 4; }
export function ImageUrl() { return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"; }
/* global
LightingMode:readonly
forcedColor:readonly
micLedMode:readonly
micMuteColor:readonly
idleTimeout:readonly
SidetoneAmount:readonly
*/
export function ControllableParameters() {
	return [
		{property:"LightingMode", group:"lighting", label:"Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", type:"combobox", values:["Canvas", "Forced"], default:"Canvas"},
		{property:"forcedColor", group:"lighting", label:"Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", min:"0", max:"360", type:"color", default:"#009bde"},
		{property:"micLedMode", group:"lighting", label:"Microphone LED Mode", description: "Sets the microphone LED behavior", type:"combobox", values:["Canvas", "MuteState"], default:"Canvas"},
		{property:"micMuteColor", group:"lighting", label:"Microphone Mute Color", description: "Sets the microphone LED color when on mute while 'Microphone LED Mode' is set to 'MuteState'", min:"0", max:"360", type:"color", default:"#ff0000"},
		{property:"SidetoneAmount", group:"", label:"Sidetone", description: "Sets the sidetone level amount", step:"1", type:"number", min:"0", max:"100", default:"0", live : false}, // Looks like not all models works with this, disabling for now, looks like to not be used that much
	];
}

export function Initialize() {
	CORSAIR.Initialize();
}

export function Render() {
	if (CORSAIR.getWirelessSupport()){

		CORSAIR.fetchStatus();

		if (!CORSAIR.Config.isSleeping){
			CORSAIR.sendColors();
			CORSAIR.fetchBattery();
		}
	} else {
		CORSAIR.sendColors();
	}
}

export function Shutdown(SystemSuspending) {

	if(SystemSuspending){
		// Go Dark on System Sleep/Shutdown
		CORSAIR.sendColors("#000000");
	}else{
		const headsetMode = CORSAIR.getWirelessSupport() === true ? 0x09 : 0x08;
		const ep = CORSAIR.getDeviceEndpoint();
		device.set_endpoint(ep.interface, ep.usage, ep.usage_page, ep.collection);
		device.write([0x02, headsetMode, 0x01, 0x03, 0x00, 0x01], 64); // Hardware mode
	}
}

export function onSidetoneAmountChanged() {
	CORSAIR.setSidetone();
}

export function onidleTimeoutChanged() {
	CORSAIR.setIdleTimeout();
}

export class CORSAIR_Device_Protocol {
	constructor() {
		this.Config = {
			DeviceProductID: 0x0000,
			DeviceName: "Corsair Headset Device",
			DeviceEndpoint: { "interface": 0, "usage": 0x0000, "usage_page": 0x0000, "collection": 0x0000 },
			ConsumerEndpoint: null, // HID Consumer Control endpoint for unsolicited mute events
			LedNames: [],
			LedPositions: [],
			Leds: [],
			Wireless: false,
			pollingInterval: 1000, // Consumer Control endpoint handles real-time events; polling is just a fallback
			lastMicStatePolling: 0,
			lastMicState: 0,
			lastBatteryPolling: 0,
			pollingBatteryInterval: 60000, // 1 Minute
			lastpollingHeadsetStatus: 0,
			pollingHeadsetStatus: 10000, // 10 seconds
			isSleeping: false,
			softwareModeActive: false,
			lastBatteryRetry: 0,
			lastRGBData: null,
		};

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
	}

	getDeviceProperties(deviceID) { return CORSAIRdeviceLibrary.PIDLibrary[deviceID];};

	getDeviceProductId() { return this.Config.DeviceProductID; }
	setDeviceProductId(productID) { this.Config.DeviceProductID = productID; }

	getDeviceName() { return this.Config.DeviceName; }
	setDeviceName(deviceName) { this.Config.DeviceName = deviceName; }

	getDeviceEndpoint() { return this.Config.DeviceEndpoint; }
	setDeviceEndpoint(deviceEndpoint) { this.Config.DeviceEndpoint = deviceEndpoint; }

	getLedNames() { return this.Config.LedNames; }
	setLedNames(ledNames) { this.Config.LedNames = ledNames; }

	getLedPositions() { return this.Config.LedPositions; }
	setLedPositions(ledPositions) { this.Config.LedPositions = ledPositions; }

	getLeds() { return this.Config.Leds; }
	setLeds(leds) { this.Config.Leds = leds; }

	getDeviceImage() { return this.Config.image; }
	setDeviceImage(image) { this.Config.image = image; }

	getWirelessSupport() { return this.Config.Wireless; }
	setWirelessSupport(wireless) { this.Config.Wireless = wireless; }

	Initialize() {
		// On re-initialization (resume/hot-reload) Windows needs ~20s to restore USB
		// device access after SignalRGB already detects the dongle — pause before any
		// write to avoid the Access Denied / Unrecoverable Error race.
		// First start: short pause only (HID handle release on fresh load).
		device.pause(_pluginInitializedBefore ? 22000 : 1000);
		_pluginInitializedBefore = true;

		//Initializing vars
		this.setDeviceProductId(device.productId());

		const DeviceProperties = this.getDeviceProperties(this.getDeviceProductId());
		this.setDeviceName(DeviceProperties.name);
		this.detectDeviceEndpoint(DeviceProperties);
		this.setLedNames(DeviceProperties.LedNames);
		this.setLedPositions(DeviceProperties.LedPositions);
		this.setLeds(DeviceProperties.Leds);
		this.setDeviceImage(DeviceProperties.image);

		if(DeviceProperties.wireless){
			this.setWirelessSupport(DeviceProperties.wireless);
			device.addFeature("battery");
			device.addProperty({"property":"idleTimeout", "group":"", "label":"Device Sleep Timeout (Minutes)", description: "Enables the device to enter sleep mode", "type":"combobox", "values":["Off", "1", "2", "3", "4", "5", "10", "15", "20", "25", "30"], "default":"10"});
			// fetchBattery() is intentionally NOT called here.
			// lastBatteryPolling starts at 0, so Render() will fetch on the first frame.
			// Calling it here causes HID "Access Denied" on hot-reload because the
			// OS hasn't released the previous handle yet.
			this.setIdleTimeout();
		}

		device.log("Device model found: " + this.getDeviceName());
		device.setName("Corsair " + this.getDeviceName());
		device.setSize(DeviceProperties.size);
		device.setControllableLeds(this.getLedNames(), this.getLedPositions());
		device.setImageFromUrl(this.getDeviceImage());

		this.modernDirectLightingMode();
	}

	modernDirectLightingMode() {
		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		const endpoint = this.getDeviceEndpoint();
		device.set_endpoint(endpoint[`interface`], endpoint[`usage`], endpoint[`usage_page`], endpoint[`collection`]);

		device.log("Setting Software Mode!");
		device.write([0x02, headsetMode, 0x01, 0x03, 0x00, 0x02], 64); // Enable Software Mode
		device.pause(120);
		device.write([0x02, headsetMode, 0x0D, 0x00, 0x01], 64); //Open lighting endpoint
		device.pause(120);

		// Verify software mode was accepted by reading back register 0x03
		const softwareModePacket = [0x02, headsetMode, 0x02, 0x03, 0x00];
		device.clearReadBuffer();
		device.write(softwareModePacket, 64);
		device.pause(60);
		const modeResponse = device.read(softwareModePacket, 64);

		// Register 0x03: value at b5 (normal) or b4 (Virtuoso XT Wireless after wakeup)
		const softwareModeConfirmed = modeResponse[5] === 0x02 || modeResponse[4] === 0x02;

		if (!softwareModeConfirmed) {
			device.log(`Software mode not confirmed (b3=${modeResponse[3].toString(16)} b4=${modeResponse[4].toString(16)} b5=${modeResponse[5].toString(16)}) - will retry.`);
			return;
		}

		const HWBrightnessPacket = [0x02, headsetMode, 0x02, 0x02, 0x00];

		device.clearReadBuffer();
		device.write(HWBrightnessPacket, 64);
		device.pause(60);

		const HWBrightness = device.read(HWBrightnessPacket, 64);

		if (HWBrightness[4] !== 0xe8 || HWBrightness[5] !== 0x03) {
			device.write([0x02, headsetMode, 0x01, 0x02, 0x00, 0xe8, 0x03], 64); //Hardware Brightness 100%
			device.pause(100);
		}

		this.Config.softwareModeActive = true;
		device.log("Software Mode activated and confirmed.");
	}

	sendColors(overrideColor) {

		const deviceLedPositions	= this.getLedPositions();
		const deviceLedNames		= this.getLedNames();
		const deviceLeds			= this.getLeds();
		const RGBData				= [];

		// Compute once outside the loop
		const isMuteMode   = micLedMode === "MuteState";
		const isForced     = !overrideColor && LightingMode === "Forced";
		const staticColor  = overrideColor ? hexToRgb(overrideColor)
		                   : isForced      ? hexToRgb(forcedColor)
		                   : null;
		const micMuteRgb   = isMuteMode ? hexToRgb(micMuteColor) : null;
		const micState     = isMuteMode ? this.fetchMicStatus() : 0;

		for (let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			let color;

			if (staticColor) {
				// overrideColor (e.g. shutdown) and Forced always win over mute mode
				color = staticColor;
			} else if(isMuteMode && deviceLedNames[iIdx] === "Mic") {
				color = micState === 1 ? micMuteRgb : device.color(deviceLedPositions[iIdx][0], deviceLedPositions[iIdx][1]);
			} else {
				color = device.color(deviceLedPositions[iIdx][0], deviceLedPositions[iIdx][1]);
			}

			RGBData[(deviceLeds[iIdx])]   = color[0];
			RGBData[(deviceLeds[iIdx])+3] = color[1];
			RGBData[(deviceLeds[iIdx])+6] = color[2];
		}

		const key = RGBData.join(",");
		if (!overrideColor && key === this.Config.lastRGBData) return;
		this.Config.lastRGBData = key;

		this.writeRGB(RGBData);
	}

	writeRGB(RGBData) {
		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		device.write([0x02, headsetMode, 0x06, 0x00, 0x09, 0x00, 0x00, 0x00].concat(RGBData), 64);
	}

	fetchMicStatus(){

		// Throttled polling via iCUE protocol
		if(Date.now() - this.Config.lastMicStatePolling < this.Config.pollingInterval) {
			return this.Config.lastMicState;
		}

		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		const micreadMode = this.getDeviceName().includes("HS80") === true ? 0xA6 : 0x46;
		const endpoint = this.getDeviceEndpoint();
		device.set_endpoint(endpoint[`interface`], endpoint[`usage`], endpoint[`usage_page`], endpoint[`collection`]);

		const micStatusPacket = [0x02, headsetMode, 0x02, micreadMode, 0x00];

		device.pause(30);
		device.clearReadBuffer();
		device.write(micStatusPacket, 64);
		device.pause(60);
		this.Config.lastMicStatePolling = Date.now();

		// The device pushes unsolicited status reports [01 01 02 00 muteState ...] ~every second.
		// These arrive before our explicit response and carry the same mute state in b4.
		// Read whatever arrived: prefer explicit response (b3=register), accept unsolicited as fallback.
		const micStatus = device.read(micStatusPacket, 64);
		let muteValue = null;

		if (device.getLastReadSize() > 0) {
			if (micStatus[3] === micreadMode) {
				muteValue = micStatus[4]; // explicit response — authoritative
			} else if (micStatus[0] === 0x01 && micStatus[2] === 0x02 && micStatus[3] === 0x00) {
				muteValue = micStatus[4]; // unsolicited status report — reliable fallback
			}
		}

		if (muteValue !== null) {
			this.Config.lastMicState = muteValue;
		}
		return this.Config.lastMicState;

	}

	setSidetone() {
		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		const endpoint = this.getDeviceEndpoint();
		device.set_endpoint(endpoint[`interface`], endpoint[`usage`], endpoint[`usage_page`], endpoint[`collection`]);

		const sidetoneValue = Math.round((SidetoneAmount / 100) * 1000);

		device.log("Setting Sidetone to: " + SidetoneAmount);
		device.write([0x02, headsetMode, 0x01, 0x47, 0x00, sidetoneValue & 0xFF, (sidetoneValue >> 8) & 0xFF], 64);
	}

	setIdleTimeout() {
		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		const endpoint = this.getDeviceEndpoint();
		device.set_endpoint(endpoint[`interface`], endpoint[`usage`], endpoint[`usage_page`], endpoint[`collection`]);

		if (idleTimeout === "Off") {
			device.log ("Setting Idle Timeout to: disabled");
			device.write([0x02, headsetMode, 0x01, 0x0D, 0x00], 64); // explicit 0x00 = disable
		} else {
			device.write([0x02, headsetMode, 0x01, 0x0D, 0x01], 64);
			device.pause(10);

			device.write([0x02, headsetMode, 0x01, 0x0D, 0x00, 0x01], 64);
			device.pause(10);

			const timeoutValue = idleTimeout * 60000;
			const hexValue = timeoutValue.toString(16).padStart(6, '0');
			const littleEndianHex = hexValue.match(/../g).reverse();

			const packet = [];
			packet[0] = 0x02;
			packet[1] = headsetMode;
			packet[2] = 0x01;
			packet[3] = 0x0e;
			packet[4] = 0x00; // padding
			packet[5] = parseInt(littleEndianHex[0], 16);
			packet[6] = parseInt(littleEndianHex[1], 16);
			packet[7] = parseInt(littleEndianHex[2], 16);

			device.log ("Setting Idle Timeout to: " + idleTimeout);
			device.write(packet, 64);
		}
	}

	fetchBattery(force = false){

		if(!force && Date.now() - this.Config.lastBatteryPolling < this.Config.pollingBatteryInterval) {
			return;
		}

		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		const endpoint = this.getDeviceEndpoint();
		device.set_endpoint(endpoint[`interface`], endpoint[`usage`], endpoint[`usage_page`], endpoint[`collection`]);

		const batteryLevelPacket = [0x02, headsetMode, 0x02, 0x0F, 0x00];
		const batteryStatusPacket = [0x02, headsetMode, 0x02, 0x10, 0x00];

		device.pause(20);
		device.clearReadBuffer();
		device.write(batteryLevelPacket, 64);
		device.pause(30);
		const batteryLevelData = device.read(batteryLevelPacket, 64);

		device.clearReadBuffer();
		device.write(batteryStatusPacket, 64);
		device.pause(30);
		const batteryStatusData = device.read(batteryStatusPacket, 64);

		const batteryLevel	=	this.ReadInt32LittleEndian(batteryLevelData.slice(4, 8));
		const batteryStatus	=	batteryStatusData[4];

		// Don't lock out for 60s if the response is invalid (e.g. read during init window)
		if (batteryStatus < 1 || batteryStatus > 3) {
			// Throttle logging: max once per 5s to avoid spam during wakeup
			if (Date.now() - this.Config.lastBatteryRetry > 5000) {
				device.log(`[Battery] Invalid response (status=${batteryStatus}) - retrying...`);
				this.Config.lastBatteryRetry = Date.now();
			}
			return;
		}

		this.Config.lastBatteryPolling	= Date.now();

		const batteryLevelPct  = (batteryLevel ?? 0) / 10;
		const batteryStateVal  = this.chargingStateDictionary[batteryStatus];

		device.log(`Battery Level is [${batteryLevelPct}%]`);
		device.log(`Battery Status is [${this.chargingStates[batteryStatus]}]`);

		battery.setBatteryLevel(batteryLevelPct);
		battery.setBatteryState(batteryStateVal);
	}

	fetchSleepStatus(){
		const headsetMode = this.getWirelessSupport() === true ? 0x09 : 0x08;
		const endpoint = this.getDeviceEndpoint();
		device.set_endpoint(endpoint.interface, endpoint.usage, endpoint.usage_page, endpoint.collection);

		const batteryStatusPacket = [0x02, headsetMode, 0x02, 0x10, 0x00];

		device.pause(60);          // drain late ACKs from color writes before clearing
		device.clearReadBuffer();
		device.write(batteryStatusPacket, 64);
		device.pause(60);

		const batteryStatusData = device.read(batteryStatusPacket, 64);

		if (device.getLastReadSize() === 0) {
			this.Config.isSleeping = true;
			this.Config.softwareModeActive = false;
			return;
		}

		if (batteryStatusData[3] === 0x10) {
			this.Config.isSleeping = batteryStatusData[4] < 1 || batteryStatusData[4] > 3;
		} else {
			this.Config.isSleeping = false;
		}

		if (this.Config.isSleeping) {
			this.Config.softwareModeActive = false;
		}
	}

	fetchStatus () {
		const now = Date.now();

		if(now - this.Config.lastpollingHeadsetStatus > this.Config.pollingHeadsetStatus) {
			this.fetchSleepStatus();
			this.Config.lastpollingHeadsetStatus = Date.now();

			// Re-activate software mode whenever headset is awake but mode is not active.
			// This handles both the wakeup transition and retries if a previous attempt failed.
			if (!this.Config.isSleeping && !this.Config.softwareModeActive) {
				device.log("Headset awake but software mode inactive - reactivating.");
				this.modernDirectLightingMode();
			}
		}
	}

	detectDeviceEndpoint(deviceLibrary) {//Oh look at me. I'm a HS80 - 0x0A6B. I'm special

		device.log("Searching for endpoints...");

		const deviceEndpoints = device.getHidEndpoints();

		// Find Consumer Control endpoint (usage_page 0x000c) for unsolicited
		// mute button events — allows event-driven detection without polling.
		const consumerEp = deviceEndpoints.find(ep => ep.usage_page === 0x000c);
		if (consumerEp) {
			this.Config.ConsumerEndpoint = consumerEp;
			device.log("Consumer Control endpoint found: " + JSON.stringify(consumerEp));
		}

		for (let endpoints = 0; endpoints < deviceLibrary.endpoint.length; endpoints++) {
			const endpoint = deviceLibrary.endpoint[endpoints];

			for (let endpointList = 0; endpointList < deviceEndpoints.length; endpointList++) {
				const currentEndpoint = deviceEndpoints[endpointList];

				if (
					endpoint.interface	=== currentEndpoint.interface	&&
					endpoint.usage		=== currentEndpoint.usage		&&
					endpoint.usage_page	=== currentEndpoint.usage_page	&&
					endpoint.collection	=== currentEndpoint.collection	) {

					this.setDeviceEndpoint(currentEndpoint);
					device.set_endpoint(
						currentEndpoint.interface,
						currentEndpoint.usage,
						currentEndpoint.usage_page,
						currentEndpoint.collection,
					);

					device.log("Endpoint " + JSON.stringify(currentEndpoint) + " found!");

					return;
				}
			}
		}

		device.log(`Endpoints not found in the device! - ${JSON.stringify(deviceLibrary.endpoint)}`);
	}

	ReadInt32LittleEndian(array){
		return (array[0] & 0xFF) | ((array[1] << 8) & 0xFF00) | ((array[2] << 16) & 0xFF0000) | ((array[3] << 24) & 0xFF000000);
	}
}

export class deviceLibrary {
	constructor(){
		this.PIDLibrary	=	{

			// Virtuoso Standard
			0x0A40: {
				name: "Virtuoso Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			0x0A41: {
				name: "Virtuoso",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0001 }
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			0x0A42: {
				name: "Virtuoso Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 },
					{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0001 }
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},

			0x0A43: {
				name: "Virtuoso", // White
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			0x0A44: {
				name: "Virtuoso Wireless", // White
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 },
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			0x0A4B: {
				name: "Virtuoso Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			0x0A4C: {
				name: "Virtuoso Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			0x0A5A: {
				name: "Virtuoso",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0001 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},
			/*
			0x0A5B: { // PID for wired WHILE wireless dongle plugged in, doesnt control the headset
				name: "Virtuoso",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},*/
			0x0A5C: {
				name: "Virtuoso Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0001 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-standard.png"
			},

			// Virtuoso SE
			0x0A3D: {
				name: "Virtuoso SE",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [
					{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0001 },
					{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-se.png"
			},
			0x0A3E: {
				name: "Virtuoso SE Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [
					{ "interface": 4, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0001 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 },
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-se.png"
			},

			// Virtuoso XT
			0x0A62: {
				name: "Virtuoso XT",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 }
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-xt.png"
			},
			0x0A64: {
				name: "Virtuoso XT Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 }
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/virtuoso-xt.png"
			},

			// HS80
			/*
			0x0A6A: { // PID for wired WHILE wireless dongle plugged in, doesnt control the headset
				name: "HS80 RGB",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : { "interface": 0, "usage": 0x0001, "usage_page": 0xFF58, "collection": 0x0001 },
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/hs80.png"
			},
			*/
			0x0A69: {
				name: "HS80 RGB",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/hs80.png"
			},
			0x0A6B: {
				name: "HS80 RGB Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 },
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/hs80.png"
			},
			0x0A71: {
				name: "HS80 RGB White",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				endpoint : [{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 }],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/hs80.png"
			},
			0x0A73: { //White
				name: "HS80 RGB White Wireless",
				size: [3, 3],
				LedNames: ["Logo", "Power", "Mic"],
				LedPositions: [[1, 0], [0, 2], [2, 2]],
				Leds: [0, 1, 2],
				wireless: true,
				endpoint : [
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0004 },
					{ "interface": 3, "usage": 0x0001, "usage_page": 0xFF42, "collection": 0x0005 },
				],
				image: "https://assets.signalrgb.com/devices/brands/corsair/audio/hs80.png"
			},
		};
	}
}

const CORSAIRdeviceLibrary = new deviceLibrary();
const CORSAIR = new CORSAIR_Device_Protocol();
let _pluginInitializedBefore = false;

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}
