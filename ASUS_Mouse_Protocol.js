import { Assert } from "@SignalRGB/Errors.js";
let savedPollTimer = Date.now();
const PollModeInternal = 15000;

/* global
LightingMode:readonly
forcedColor:readonly
SettingControl:readonly
dpi1:readonly
dpi2:readonly
dpi3:readonly
dpi4:readonly
mousePolling:readonly
mouseResponse:readonly
angleSnapping:readonly
sleepTimeout:readonly
lowPowerPercentage:readonly
*/

export class AsusMouse {
	constructor() {
		this.Config = {
			DeviceProductID: 0x0000,
			DeviceName: "Asus Mouse",
			LedNames: [],
			LedPositions: [],
			SupportedFeatures:
			{
				DPISupport: false,
				AngleSnapSupport: false,
				PollingRateSupport: false,
			},
			lastRGBData: null,
		};
	}

	getDeviceName() { return this.Config.DeviceName; }
	setDeviceName(deviceName) { this.Config.DeviceName = deviceName; }

	getLedNames() { return this.Config.LedNames; }
	setLedNames(ledNames) { this.Config.LedNames = ledNames; }

	getLedPositions() { return this.Config.LedPositions; }
	setLedPositions(ledPositions) { this.Config.LedPositions = ledPositions; }

	getDPISupport() { return this.Config.SupportedFeatures.DPISupport; }
	setDPISupport(dpi) { this.Config.SupportedFeatures.DPISupport = dpi; }

	getAngleSnapFeature() { return this.Config.SupportedFeatures.AngleSnapSupport; }
	setAngleSnapFeature(angleSnapping) { this.Config.SupportedFeatures.AngleSnapSupport = angleSnapping; }

	getPollingFeature() { return this.Config.SupportedFeatures.PollingRateSupport; }
	setPollingFeature(polling) { this.Config.SupportedFeatures.PollingRateSupport = polling; }

	getSleepFeature() { return this.Config.SupportedFeatures.SleepTimeoutSupport; }
	setSleepFeature(sleep) { this.Config.SupportedFeatures.SleepTimeoutSupport = sleep; }

	getLowPowerFeature() { return this.Config.SupportedFeatures.LowPowerPercentage; }
	setLowPowerFeature(lowPower) { this.Config.SupportedFeatures.LowPowerPercentage = lowPower; }

	initializeAsus(deviceName) {
		//Initializing vars
		

		const DeviceProperties = MouseLibrary.GetMappingFromName(deviceName);

		if(DeviceProperties){
			this.setDeviceName(deviceName);
			this.setLedNames(DeviceProperties.vLedNames);
			this.setLedPositions(DeviceProperties.vLedPositions);
			console.log("Initializing device...");

			if(DeviceProperties.DPISupport === true){
				this.setDPISupport(true);
				this.setAngleSnapFeature(true);
				this.setPollingFeature(true);

				device.addProperty({"property":"SettingControl", "group":"mouse", "label":"Enable Setting Control", description: "SignalRGB will not attempt to set mouse settings like DPI and Polling Rate while this is disabled", "type":"boolean", "default" :"false"});
				device.addProperty({"property":"dpi1", "group":"dpi", "label":"DPI 1", "step":"100", "type":"number", "min":"100", "max": DeviceProperties.maxDPI, "default": "800", "live" : false});
				device.addProperty({"property":"dpi2", "group":"dpi", "label":"DPI 2", "step":"100", "type":"number", "min":"100", "max": DeviceProperties.maxDPI, "default":"1200", "live" : false});
				device.addProperty({"property":"dpi3", "group":"dpi", "label":"DPI 3", "step":"100", "type":"number", "min":"100", "max": DeviceProperties.maxDPI, "default":"1500", "live" : false});
				device.addProperty({"property":"dpi4", "group":"dpi", "label":"DPI 4", "step":"100", "type":"number", "min":"100", "max": DeviceProperties.maxDPI, "default":"2000", "live" : false});
				device.addProperty({"property":"angleSnapping", "group":"mouse", "label":"Angle Snapping", description: "Enables Angle Snapping on the mouse. This will result in the cursor moving only in straight lines", "type":"boolean", "default":"false"});
				device.addProperty({"property":"mousePolling", "group":"mouse", "label":"Polling Rate", description: "Sets the Polling Rate of this device", "type":"combobox", "values":["125Hz", "250Hz", "500Hz", "1000Hz"], "default":"500Hz"});
				device.addProperty({"property":"mouseResponse", "group":"mouse", "label":"button response", "type":"combobox", "values":["12ms", "16ms", "20ms", "24ms", "28ms", "32ms"], "default":"16ms"});

				for(let i = 0; i < 5; i++){
					this.sendMouseSetting(i);
				}

				this.sendMouseSetting(6);
			}

			this.modernDirectLightingMode();
			console.log("This is a Modern device");

			device.addFeature("battery");
			console.log("Device has a battery and it's wireless");
			device.addProperty({"property":"sleepTimeout", "group":"mouse", "label":"Sleep Mode Timeout (Minutes)", "type":"combobox", "values":["1", "2", "3", "5", "10", "Never"], "default":"5"});
			device.addProperty({"property":"lowPowerPercentage", "group":"mouse", "label":"Low Battery Warning Percentage", "type":"combobox", "values":["Never", "10%", "15%", "20%", "25%", "30%"], "default":"20%"});

			this.sendLightingSettings();
			this.modernFetchBatteryLevel();

			console.log(`Device model found: ` + this.getDeviceName());
			device.setName("ASUS " + this.getDeviceName());
			device.setSize(DeviceProperties.size);
			device.setControllableLeds(this.getLedNames(), this.getLedPositions());
			device.setImageFromUrl(DeviceProperties.image);
		}else{
			device.notify("Unknown device", `Reach out to support@signalrgb.com, or visit our Discord to get it added.`, 0);
			console.log("Model not found in library!");
		}
	}

	modernDirectLightingMode() {
		const packet = [0x03, 0x51, 0x28, 0x03, 0x00, 0x02, 0x64, 0x02]; //Direct Mode
		device.write(packet, 65);
	}

	sendColors(overrideColor) {

		if(this.getDeviceName() === "Asus Mouse"){
			return;
		}

		const deviceLeds = this.getLedPositions();
		const RGBData = [];

		for(let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			const iPxX = deviceLeds[iIdx][0];
			const iPxY = deviceLeds[iIdx][1];
			let color;

			if(overrideColor) {
				color = hexToRgb(overrideColor);
			} else if (LightingMode === "Forced") {
				color = hexToRgb(forcedColor);
			} else {
				color = device.color(iPxX, iPxY);
			}

			const iLedIdx = (iIdx * 3);
			RGBData[iLedIdx] = color[0];
			RGBData[iLedIdx+1] = color[1];
			RGBData[iLedIdx+2] = color[2];
		}

		const key = RGBData.join(",");
		if (!overrideColor && key === this.Config.lastRGBData) return;
		this.Config.lastRGBData = key;

		device.write([0x03, 0x51, 0x29, 0xff, 0x00, 0x00].concat(RGBData), 64);
	}

	getDeviceBatteryStatus() {
		if(this.getDeviceName() === "Asus Mouse"){
			return;
		}

		if (Date.now() - savedPollTimer < PollModeInternal) {
			return;
		}

		console.log("Device has battery, polling info...");
		savedPollTimer = Date.now();

		this.modernFetchBatteryLevel();

	}

	modernFetchBatteryLevel() {
		device.clearReadBuffer();
		device.write([0x03, 0x12, 0x07], 65);

		const returnPacket = device.read([0x03, 0x12, 0x07], 65);

		if (!returnPacket || returnPacket.length < 10) {
			device.log("⚠️ Battery read failed or returned empty packet.");

			return;
		}

		const batteryLevel = returnPacket[5];
		const batteryState = returnPacket[10];

		device.log(`🔋 Battery: ${batteryLevel}% | State: ${MouseLibrary.chargingStates[batteryState]}`);

		battery.setBatteryLevel(batteryLevel);
		battery.setBatteryState(batteryState + 1);
	}

	sendMouseSetting(setting) {
		if(SettingControl) {
			switch (setting) {
			case 0:
				device.write([0x03, 0x51, 0x31, 0x00, 0x00, (dpi1/100 + 1)], 65);
				break;
			case 1:
				device.write([0x03, 0x51, 0x31, 0x01, 0x00, (dpi2/100 + 1)], 65);
				break;
			case 2:
				device.write([0x03, 0x51, 0x31, 0x02, 0x00, (dpi3/100 + 1)], 65);
				break;
			case 3:
				device.write([0x03, 0x51, 0x31, 0x03, 0x00, (dpi4/100 + 1)], 65);
				break;
			case 4:
				device.write([0x03, 0x51, 0x31, 0x04, 0x00, MouseLibrary.pollingDict[mousePolling]], 65);
				break;
			case 5:
				device.write([0x03, 0x51, 0x31, 0x05, 0x00, MouseLibrary.responseDict[mouseResponse]], 65);
				break;
			case 6:
				device.write([0x03, 0x51, 0x31, 0x06, 0x00, angleSnapping ? 0x01 : 0x00], 65);
				break;
			default:
				console.log("Not a valid mouse setting: " + setting);
				break;
			}

			device.write([0x03, 0x50, 0x03, 0x03], 65); // Apply
		}
	}

	sendAllMouseSettings() {
		if(SettingControl) {
			device.write([0x03, 0x51, 0x31, 0x00, 0x00, (dpi1/100 + 1)], 65);
			device.write([0x03, 0x51, 0x31, 0x01, 0x00, (dpi2/100 + 1)], 65);
			device.write([0x03, 0x51, 0x31, 0x02, 0x00, (dpi3/100 + 1)], 65);
			device.write([0x03, 0x51, 0x31, 0x03, 0x00, (dpi4/100 + 1)], 65);
			device.write([0x03, 0x51, 0x31, 0x04, 0x00, MouseLibrary.pollingDict[mousePolling]], 65);
			device.write([0x03, 0x51, 0x31, 0x05, 0x00, MouseLibrary.responseDict[mouseResponse]], 65);
			device.write([0x03, 0x51, 0x31, 0x06, 0x00, angleSnapping ? 0x01 : 0x00], 65);
			device.write([0x03, 0x50, 0x03, 0x03], 65);
		}
	}

	sendLightingSettings() {
		if(SettingControl) {
			const lightingSettingsPacket = [0x03, 0x51, 0x37, 0x00, 0x00,
				MouseLibrary.sleepModeDict[sleepTimeout], 0x00,
				MouseLibrary.lowPowerPercentageDict[lowPowerPercentage]];
			device.write(lightingSettingsPacket, 65);

			const applyPacket = [0x03, 0x50, 0x03];
			device.write(applyPacket, 65);
		}
	}

}

export class AsusMouseLibrary {
	constructor(){
		this.modelLibrary	=	{
			"R3MPGDD21800" : "ROG Harpe Ace AIM LAB Edition",
			"SAMPGDD00EAH" : "ROG Keris II Origin",
			"R9MPGDD81805" : "ROG Keris II Ace",
			"E503FF3290C8" : "ROG Keris Aimpoint",
			'0x1A70' 	   : "ROG Gladius III Aimpoint"
		};

		this.ledLibrary	=	{
			"ROG Gladius III Aimpoint":
			{
				size: [3, 5],
				vLedNames: ["Scroll Wheel"],
				vLedPositions: [[1, 0]],
				maxDPI: 36000,
				DPISupport: true,
				image: "https://assets.signalrgb.com/devices/brands/asus/mice/harpe-aim-lab.png"
			},
			"ROG Harpe Ace AIM LAB Edition":
			{
				size: [3, 5],
				vLedNames: ["Scroll Wheel"],
				vLedPositions: [[1, 0]],
				maxDPI: 36000,
				DPISupport: true,
				image: "https://assets.signalrgb.com/devices/brands/asus/mice/harpe-aim-lab.png"
			},
			"ROG Keris II Origin":
			{
				size: [3, 6],
				vLedNames: ["Logo", "Scroll Wheel", "Side strip"],
				vLedPositions: [[1, 0], [1, 5], [0, 4]],
				maxDPI: 42000,
				DPISupport: true,
				image: "https://assets.signalrgb.com/devices/brands/asus/mice/keris-ii-origin.png"
			},
			"ROG Keris II Ace":
			{
				size: [1, 1],
				vLedNames: ["Scroll Wheel"],
				vLedPositions: [[0, 0]],
				maxDPI: 42000,
				DPISupport: true,
				image: "https://assets.signalrgb.com/devices/brands/asus/mice/keris-ii-ace.png"
			},
			"ROG Keris Aimpoint":
			{
				size: [7, 8],
				vLedNames: ["Logo", "Scroll Wheel"],
				vLedPositions: [[3, 5], [3, 0]],
				maxDPI: 16000,
				DPISupport: true,
				image: "https://assets.signalrgb.com/devices/brands/asus/mice/keris-wireless.png",
			},
		};

		this.pollingDict = {
			"125Hz"  : 0,
			"250Hz"  : 1,
			"500Hz"  : 2,
			"1000Hz" : 3,
		};

		this.responseDict = {
			"12ms" : 2,
			"16ms" : 3,
			"20ms" : 4,
			"24ms" : 5,
			"28ms" : 6,
			"32ms" : 7,
		};

		this.sleepModeDict = {
			"1" : 0x00,
			"2" : 0x01,
			"3" : 0x02,
			"5" : 0x03,
			"10" : 0x04,
			"Never" : 0xff
		};

		this.lowPowerPercentageDict = {
			"Never" : 0x00,
			"10%" : 0x0A,
			"15%" : 0x0F,
			"20%" : 0x14,
			"25%" : 0x19,
			"30%" : 0x1E
		};

		this.chargingStates = Object.freeze({
			0: "Discharging",
			1: "Charging",
			2: "Fully Charged",
		});
	}

	GetMappingFromName(deviceName) {
		if(deviceName in this.ledLibrary) {
			device.log(`Found Valid Mouse Layout Mapping for ${deviceName}!`, {toFile :true});

			return this.ledLibrary[deviceName]
		}

		return {};
	}
}

const MouseLibrary = new AsusMouseLibrary();

export function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}