import { AsusKeyboard } from "./ASUS_Keyboard_Protocol.js";
import { AsusMouse } from "./ASUS_Mouse_Protocol.js";
import { Assert } from "@SignalRGB/Errors.js";
import DeviceDiscovery from "@SignalRGB/DeviceDiscovery";
export function Name() { return "ASUS Omni Device"; }
export function VendorId() { return 0x0B05; }
export function ProductId() { return 0x1ACE; }
export function Publisher() { return "WhirlwindFx"; }
export function Documentation() { return "troubleshooting/asus"; }
export function DeviceType(){return "dongle";}
export function Size() { return [1, 1]; }
/* global
LightingMode:readonly
forcedColor:readonly
shutdownMode:readonly
shutdownColor:readonly
idleTimeout:readonly
keyDebounce:readonly
oledMode:readonly
oledAnimation:readonly
oledBanner:readonly
oledBannerText:readonly
oledBannerFontSize:readonly
*/
export function ControllableParameters() {
	return [
		{property: "shutdownMode", group: "lighting", label: "Shutdown Mode", description: "Sets whether the device should follow SignalRGB shutdown color, or go back to hardware lighting", type: "combobox", values: ["SignalRGB", "Hardware"], default: "Hardware" },
		{property:"shutdownColor", group:"lighting", label:"Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", min:"0", max:"360", type:"color", default:"#000000"},
		{property:"LightingMode", group:"lighting", label:"Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", type:"combobox", values:["Canvas", "Forced"], default:"Canvas"},
		{property:"forcedColor", group:"lighting", label:"Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", min:"0", max:"360", type:"color", default:"#009bde"},

	];
}

export function ImageUrl() {
	return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png";
}

export function Validate(endpoint) {
	return endpoint.interface === 1 || endpoint.interface === 2 || endpoint.interface === 3;
}


//kb fw 7.00.01 dongle fw 6.00.19
// 01 A1 returns USB Serial for the keyboard in Omni. 3 Bytes of padding then ASCII encoded

// 02 12 14 02 returns the identifier we currently call "model" with one byte of padding beforehand. Seems to be some other type of UUID.
// 02 12 07 returns 04 81 05 00 01 and is sent directly after identifier check. This packet is 21 bytes long
// 02 12 03 returns 01 Device connected packet.
// 02 12 returns 3 bytes of padding then 19 00 06 00 06 02 06 01 00 07 //FW versions for kb and dongle
// 02 12 01 returns 3bytes of padding then 63 02 02 00 14 63 cf 10
// 02 22 01 returns itself
// 02 12 12 returns 2 bytes of padding then 01 11
// 02 7D 20 02 returns 02 ff aa //Probably a feature check

let isConnected = false;
let deviceType = "keyboard";
let deviceName;
let productId;
let savedPollTimer = Date.now();
const PollModeInternal = 1000;

//TODO: Yell at people for having two devices connected or try making omni work?
//Most of the infra for dual device is already built, can have a master and subdevice just to make things easier.

const mouseDict = {
	'0x1A70': "ROG Gladius III Aimpoint",
};

const keebDict = {
	'0x1AAE': "ROG Strix Scope II 96 Wireless",
	'0x1B78': "ROG Strix Scope II 96 Wireless",
	'0x1A83': "ROG Azoth"
};

function getDeviceNameAndSetType(productId) {
	if(productId in keebDict) {
		const devName = keebDict[productId];
		deviceType = "keyboard";
		device.log(`Found ${devName} keyboard!`, { toFile : true });

		return devName;
	} else if (productId in mouseDict) {
		const devName = mouseDict[productId];
		deviceType = "mouse";
		device.log(`Found ${devName} mouse!`, { toFile : true });

		return devName;
	}

	device.log("DEVICE NOT IN LIBRARY, reach out to SignalRGB support to get it added.", { toFile : true });

	return;
}

export function Initialize() {

	productId = Omni.getOmniPid();

	deviceName = getDeviceNameAndSetType(productId);

	if(deviceName.length === 0) {
		//We don't know what it is, throw, we're done here.
		return;
	}

	if(deviceType === "keyboard") {
		Omni.initializeOmniKeyboard();
	} else if(deviceType === "mouse") {
		Omni.initializeOmniMouse();
	}

	if(isConnected) {
		DeviceDiscovery.foundVirtualDevice({
			type: deviceType,
			name: deviceName,
			supported: true,
			vendorId: 0x0B05
		});

		deviceType === "keyboard" ? OmniKeyboard.initializeAsus(deviceName) : OmniMouse.initializeAsus(deviceName);
	}

}

function readMouseInputs() {
	if (Date.now() - savedPollTimer < PollModeInternal) {
		return;
	}

	savedPollTimer = Date.now();

	device.set_endpoint(
		3,
		0x0001,
		0xffc1);

	do{
		const returnPacket = device.read([0x00], 65);

		if(returnPacket[0] === 0x05 && returnPacket[1] === 0x12 && returnPacket[2] === 0x08) {
			if(returnPacket[5] === 0x01) {
				console.log("Device Reconnected!");
				checkIsConnected();
			}

			if(returnPacket[5] === 0x00) {
				console.log("Device Disconnected!");
				isConnected = false;
			}
		}
	}
	while(device.getLastReadSize() > 0);

	device.set_endpoint(
		2,
		0x01,
		0xff01);
}

function readKeyboardInputs() {
	if (Date.now() - savedPollTimer < PollModeInternal) {
		return;
	}

	savedPollTimer = Date.now();

	device.set_endpoint(
		3,
		0x0001,
		0xffc0);

	do{
		const returnPacket = device.read([0x00], 65);

		if(returnPacket[0] === 0x04 && returnPacket[1] === 0x81 && returnPacket[2] === 0x03) {
			if(returnPacket[5] === 0x01) {
				console.log("Device Reconnected!");
				checkIsConnected();
			}

			if(returnPacket[5] === 0x00) {
				console.log("Device Disconnected!");
				isConnected = false;
			}
		}
	}
	while(device.getLastReadSize() > 0);

	device.set_endpoint(
		2,
		0x01,
		0xff00);
}

function checkIsConnected() {
	if(deviceType === "mouse") {
		Omni.initializeOmniMouse();

		if(isConnected && deviceName) {
			DeviceDiscovery.foundVirtualDevice({
				type: "mouse",
				name: deviceName,
				supported: true,
				vendorId: 0x0B05
			});
			OmniMouse.initializeAsus(deviceName);
		}
	} else {
		Omni.initializeOmniKeyboard();

		if(isConnected && deviceName) {
			DeviceDiscovery.foundVirtualDevice({
				type: "keyboard",
				name: deviceName,
				supported: true,
				vendorId: 0x0B05
			});
			OmniKeyboard.initializeAsus(deviceName);
		}
	}
}

export function Render() {
	if(!isConnected) {
		checkIsConnected();
		device.pause(100);

		return;
	}

	if(deviceType === "mouse") {
		readMouseInputs();
		OmniMouse.getDeviceBatteryStatus();
		OmniMouse.sendColors();
	} else {
		readKeyboardInputs();
		OmniKeyboard.getDeviceBatteryStatus();
		OmniKeyboard.sendColors();
	}
}

export function Shutdown(SystemSuspending) {
	const color = SystemSuspending ? "#000000" : shutdownColor;

	if(deviceType === "mouse") {
		OmniMouse.sendColors(color);
	} else {
		OmniKeyboard.sendColors(color);
	}
}

const OmniMouse = new AsusMouse();
const OmniKeyboard = new AsusKeyboard();

class AsusOmniHandler{
	constructor() {
	}

	initializeOmniKeyboard() {
		device.set_endpoint(
			2,
			0x01,
			0xff00);

		const maxAttempts = 4;
		let attempt = 0;
		let deviceAlivePacket;
		let connectedStatus;

		while (attempt < maxAttempts) {
			device.write([0x02, 0x12, 0x03], 64);
			device.pause(10);

			deviceAlivePacket = device.read([0x02, 0x12, 0x03], 64);
			connectedStatus = deviceAlivePacket[5];

			if (connectedStatus === 1) {
				console.log("Wireless device connected, enabling data transfer.");
				isConnected = true;
				break;
			} else {
				isConnected = false;
			}

			attempt++;
			device.pause(50); // Pause to prevent overflow
		}
	}

	initializeOmniMouse() {
		device.set_endpoint(
			2,
			0x01,
			0xff01);

		const maxAttempts = 4;
		let attempt = 0;
		let deviceAlivePacket;
		let connectedStatus;

		while (attempt < maxAttempts) {
			device.write([0x03, 0x12, 0x00, 0x02], 64);
			device.pause(10);

			deviceAlivePacket = device.read([0x03, 0x12, 0x00, 0x02], 64);
			connectedStatus = deviceAlivePacket[5];

			if (connectedStatus === 1) {
				console.log("Wireless device connected, enabling data transfer.");
				isConnected = true;
				break;
			} else {
				isConnected = false;
			}

			attempt++;
			device.pause(50); // Pause to prevent overflow
		}
	}
	//There's a second pid that is probably returned on returnPacket[8] and returnPacket[7] if dual connection.
	//TODO: Investigate
	getOmniPid() {
		device.set_endpoint(
			2,
			0x01,
			0xff02);

		device.write([0x01, 0xA0], 64);

		const returnPacket = device.read([0x01, 0xA0], 64);

		const attachedPid = '0x' +
		returnPacket[6].toString(16).toUpperCase() +
		(returnPacket[5] - 2).toString(16).toUpperCase();

		device.log(`Attached Device PID: ${attachedPid} `);

		device.set_endpoint(
			2,
			0x01,
			0xff00);

		return attachedPid;
	}

	getDeviceModelKeyboard() {
		device.set_endpoint(
			2,
			0x01,
			0xff00);

		const modelPacket = sendPacketWithResponse([0x02, 0x12, 0x14, 0x02]).slice(5, 17);
		const model = String.fromCharCode(...modelPacket).trim().replace(/\u0000/g, '');

		console.log(`Model: ${model}`, { toFile : true});

		return model;
	}

	getDeviceModelMouse() {
		device.set_endpoint(
			2,
			0x01,
			0xff01);

		//also checks 02
		const modelPacket = sendPacketWithResponse([0x03, 0x12, 0x12, 0x01]).slice(5, 17);

		const model = String.fromCharCode(...modelPacket).trim().replace(/\u0000/g, '');

		console.log(`Model: ${model}`, { toFile : true});

		return model;
	}
}

const Omni = new AsusOmniHandler();

export function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}

function sendPacketWithResponse(packet) {
	device.clearReadBuffer();

	device.write(packet, 64);
	device.pause(10);

	const returnPacket = device.read(packet, 64);

	return returnPacket;
}

export function onidleTimeoutChanged() {
	if(deviceType === "keyboard") {
		OmniKeyboard.setIdleTimeout();
	}
}

export function onkeyDebounceChanged() {
	if(deviceType === "keyboard") {
		OmniKeyboard.setDebounce();
	}
}

export function onoledAnimationChanged() {
	if(deviceType === "keyboard") OmniKeyboard.setOledContent();
}

export function onoledModeChanged() {
	if(deviceType === "keyboard") OmniKeyboard.setOledContent();
}

export function onoledBannerChanged() {
	if(deviceType === "keyboard") OmniKeyboard.setBanner();
}

export function onoledBannerTextChanged() {
	if(deviceType === "keyboard") OmniKeyboard.setBanner();
}

export function onoledBannerFontSizeChanged() {
	if(deviceType === "keyboard") OmniKeyboard.setBanner();
}

export function ondpi1Changed() {
	OmniMouse.sendMouseSetting(0);
}

export function ondpi2Changed() {
	OmniMouse.sendMouseSetting(1);
}

export function ondpi3Changed() {
	OmniMouse.sendMouseSetting(2);
}

export function ondpi4Changed() {
	OmniMouse.sendMouseSetting(3);
}

export function onmousePollingChanged() {
	OmniMouse.sendMouseSetting(4);
}

export function onangleSnappingChanged() {
	OmniMouse.sendMouseSetting(6);
}

export function onSettingControlChanged() {
	if(OmniMouse.getDPISupport()){
		for(let i = 0; i< 4; i++){
			OmniMouse.sendMouseSetting(i);
		}

		OmniMouse.sendMouseSetting(4);
		OmniMouse.sendMouseSetting(6);

		OmniMouse.sendLightingSettings();
	}
}