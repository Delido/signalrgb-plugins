export function Name() { return "Corsair Commander Core"; }
export function VendorId() { return 0x1b1c; }
export function ProductId() { return [0x0C1C, 0x0C32]; }
export function Publisher() { return "WhirlwindFX"; }
export function Size() { return [1, 1]; }
export function DefaultPosition() { return [0, 0]; }
export function DefaultScale() { return 1.0; }
export function DeviceType(){return "lightingcontroller"}
/* global
LightingMode:readonly
forcedColor:readonly
cpuCooler:readonly
*/
export function ControllableParameters() {
	return [
		{ "property": "LightingMode", "group":"lighting", "label": "Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", "type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas" },
		{ "property": "forcedColor", "group":"lighting", "label": "Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", "min": "0", "max": "360", "type": "color", "default": "#009bde" },
		{ "property": "cpuCooler", "group": "", "label": "Pump Type", description: "Sets the pump head component being used with this controller. - corsair commander core - if you have the normal, LCD, or Elite version. Affects RGB, if configured incorrectly components get shifted", "type": "combobox", "values": ["None", "Elite Capellix", "Elite LCD", "Elite RGB"], "default": "Elite Capellix" },
	];
}
const ParentDeviceName = "Corsair Lighting Commander Core";
export function LedNames() { return []; }
export function LedPositions() { return []; }

export function SubdeviceController() { return true; }
export function SupportsFanControl(){ return true; }
// Use the CorsairLink mutex any time this device is rendering.
// if we don't our reads may be ruined by other programs
export function UsesCorsairMutex(){ return true; }
export function DefaultComponentBrand() { return "Corsair"; }
export function Documentation(){ return "troubleshooting/corsair"; }

/** @type {ValidateExport} */
export function Validate(endpoint) {
	return endpoint.interface === 0x0000 && endpoint.usage === 0x0001 && endpoint.usage_page === 0xFF42;
}

const deviceArray = [
	"Elite Capellix Pump",
];

function SetupChannels() {
	device.SetLedLimit(DeviceMaxLedLimit);

	for(let i = 0; i < ChannelArray.length; i++) {
		const channelInfo = ChannelArray[i];

		if(channelInfo){
			device.addChannel(...channelInfo);
		}
	}
}

/** @type {ChannelConfigArray} */
const ChannelArray = [
	["Channel 1", 204, 204],
];

let ConnectedFans = [];
let ConnectedProbes = [];
let savedPollFanTimer = Date.now();
const PollModeInternal = 4000;
let PumpDevice = null;
let PumpConnected = false;
const PumpDeviceName = "Elite Capellix Pump";

const Products = {
	OriginalModel: {productId: 0x0C1C, firmware: "2.10.219"}
};

const FanControllerArray = [
	"Pump",
	"Fan 1",
	"Fan 2",
	"Fan 3",
	"Fan 4",
	"Fan 5",
	"Fan 6",
];

const DeviceMaxLedLimit = 204;

/** @type {Options} */
const options = {
	developmentFirmwareVersion: "2.10.219",
	IsLightingController: true
};

function compareVersion(a, b) {
	return compareVersionRecursive(a.split("."), b.split(".")) >= 0;
}

function compareVersionRecursive(a, b) {
	if (a.length === 0) { a = [0]; }

	if (b.length === 0) { b = [0]; }

	if (a[0] !== b[0] || (a.length === 1 && b.length === 1)) {
		return a[0] - b[0];
	}

	return compareVersionRecursive(a.slice(1), b.slice(1));
}

export function Initialize() {
	if(StateMgr.states.length === 0){
		StateMgr.Push(new StateSetFanSpeeds(StateMgr));
		StateMgr.Push(new StatePollTempProbes(StateMgr));
		StateMgr.Push(new StatePollFanSpeeds(StateMgr));
	}

	// Account for different firmware versions between product Id's
	if(device.productId() === 0x0C1C){
		Corsair.config.developmentFirmwareVersion = "2.10.219";
	}else if(device.productId() === 0x0C32){
		Corsair.config.developmentFirmwareVersion = "2.0.17";
	}

	Corsair.SetMode("Software");
	Corsair.OpenHandle("Lighting", Corsair.Endpoints.LightingController);

	SetupChannels();

	device.log(`Vid is ${Corsair.FetchProperty("Vendor Id")}`);
	device.log(`Pid is ${Corsair.FetchProperty("Product Id")}`);

	Corsair.FetchFirmware();

	// With auto detection of buffer size I don't think this is needed anymore, but im leaving it here for posterity.

	/// Any Firmware => 2.10.219 requires a different packet size
	/// if(compareVersion(firmwareVersion, "2.10.219")){ //0x0C32 PID uses 2.0.17
	/// 	Corsair.SetDeviceBufferSize(97);
	/// }

	Corsair.SetFanType();
	PumpConnected = FetchPumpConnectionStatus();
	SetPumpType();

	//GetFanSettings();

}

function ConvertWordToBytes(word){
	return {low: word & 0xFF, high: word >> 8};
}

export function Shutdown(SystemSuspending) {
	if(SystemSuspending){
		// Go Dark on System Sleep/Shutdown
		UpdateRGB("#000000");
	}else{
		Corsair.SetMode("Hardware");
		ConnectedFans = [];

	}
}

export function Render() {

	UpdateRGB();

	StateMgr.process();
	//PollFans();
}

function UpdateRGB(overrideColor){

	let RGBData = GetColors(overrideColor);

	// Above 238 LED's seems to freak out the controller, Avoid the slice if we can.
	if(RGBData.length > 238 * 3){
		RGBData = RGBData.slice(0, 238 * 3);
	}

	Corsair.SendRGBData(RGBData);
}

// export function onpumpToggleChanged(){
// 	SetPumpType(pumpToggle);
// }
export function oncpuCoolerChanged(){
	SetPumpType();
}

function SetPumpType() {
	if(!PumpConnected){
		PumpDevice = null;
	}else{
		PumpDevice = DeviceDict[cpuCooler];
	}

	if(PumpDevice === null) {
		device.removeSubdevice(PumpDeviceName);
	} else {
		//"Ch1 | Port 1"
		device.createSubdevice(PumpDeviceName);
		// Parent Device + Sub device Name + Ports
		device.setSubdeviceName(PumpDeviceName,
			`${ParentDeviceName} - ${PumpDevice.displayName} - ${PumpDeviceName}`);

		device.setSubdeviceImageUrl(PumpDeviceName, PumpDevice.image);

		device.setSubdeviceSize(PumpDeviceName,
			PumpDevice.width,
			PumpDevice.height);

		device.setSubdeviceLeds(PumpDeviceName,
			PumpDevice.LedNames,
			PumpDevice.positioning);
	}
}


function GetColors(overrideColor) {
	/** @type {number[]} */

	let RGBData = GetPumpLedData();

	const componentChannel = device.channel(ChannelArray[0][0]);

	if(!componentChannel){
		return RGBData;
	}

	let ChannelLedCount = componentChannel.LedCount();

	let ColorData = [];

	if(overrideColor) {
		ColorData = device.createColorArray(overrideColor, ChannelLedCount, "Inline");
	}else if(LightingMode  === "Forced") {
		ColorData = device.createColorArray(forcedColor, ChannelLedCount, "Inline");
	} else if(componentChannel.shouldPulseColors()) {
		ChannelLedCount = 34 * 6;

		const pulseColor = device.getChannelPulseColor(ChannelArray[0][0]);
		ColorData = device.createColorArray(pulseColor, ChannelLedCount, "Inline");

	} else {
		const components = componentChannel.getComponentNames();

		// The pump only supports 6 connected components. We need to ignore everything above that.
		for(let i = 0; i < Math.min(components.length, 6); i++) {
			let ComponentColors;

			// Each fan group is set to 34 Leds long, Each Component Must take up that many LEDs

			if(!componentChannel.overrideColors){
				ComponentColors = componentChannel.getComponentColors(components[i], "Inline");

				for(let j = ComponentColors.length; j < 34 * 3; j++) {
					ComponentColors.push(0);
				}

			}else{
				ComponentColors = [];

				for(let j = 0; j < 34; j++) {
					ComponentColors.push(0);
					ComponentColors.push(128);
					ComponentColors.push(0);
				}
			}

			ColorData = ColorData.concat(ComponentColors);
		}
	}

	RGBData = RGBData.concat(ColorData);

	return RGBData;
}

function GetPumpLedData() {
	if (PumpDevice === null) {
		return [];
	}

	const RGBData = [];

	for (let iIdx = 0; iIdx < PumpDevice.mapping.length; iIdx++) {
		const [iPxX, iPxY] = PumpDevice.positioning[iIdx];
		let mxPxColor;

		//find colors
		if (LightingMode === "Forced") {
			mxPxColor = hexToRgb(forcedColor);
		} else {
			mxPxColor = device.subdeviceColor(deviceArray[0], iPxX, iPxY);
		}

		//set colors
		RGBData[PumpDevice.mapping[iIdx] * 3] = mxPxColor[0];
		RGBData[PumpDevice.mapping[iIdx] * 3 + 1] = mxPxColor[1];
		RGBData[PumpDevice.mapping[iIdx] * 3 + 2] = mxPxColor[2];
	}


	return RGBData;
}

function FetchPumpConnectionStatus(){
	const FanData = Corsair.FetchFanStates();
	//return false;
	console.log(FanData)
	if(FanData[0] === 0){
		device.log("Pump is Disconnected!", {toFile: true});

		return false;
	}else if(FanData[0] === 7 ){ //Added State 1 in 2.2.30. Fixed a user that had it working properly in ICUE, but not Signal.
		device.log("Pump is Connected! Creating Subdevice...", {toFile: true});

		return true;
	}

	device.log(`Unknown Pump State: [${FanData[0]}]`, {toFile: true});

	device.log(`Failed to read pump connection status...`);

	return false;
}

function GetFanSettings() {

	const FanData = Corsair.FetchFanStates();

	// Skip iterating other fans and creating FanControllers if the system is disabled.
	if(device.fanControlDisabled()) {
		// Reset if the system was disbled during runtime.
		device.log("System Monitoring disabled, Clearing Connected Fans", {toFile: true});
		ConnectedFans = [];

		return false;
	}

	if(ConnectedFans.length !== 0){
		return true;
	}

	for(let i = 0; i < FanData.length; i++) {
		const fanState = FanData[i];

		switch(fanState){
		case 1:
			device.log(`${FanControllerArray[i]} is Disconnected!`);
			break;

		case 2: //Chance broke this with the D-30's and we have no idea what state 2 does. Let's see.
			if(!ConnectedFans.includes(i)){
				device.createFanControl(FanControllerArray[i]);
				ConnectedFans.push(i);
				device.log(`Found ${FanControllerArray[i]}`);
			}

			break;
		case 4:
			device.log("Device is still booting up. We'll refetch fan states later...", {toFile: true});
			ConnectedFans = [];

			return false;
		case 7:
			if(!ConnectedFans.includes(i)){
				device.createFanControl(FanControllerArray[i]);
				ConnectedFans.push(i);
				device.log(`Found ${FanControllerArray[i]}`);
			}

			break;
		default:
			device.log(`${FanControllerArray[i]}: Unknown Fan State [${fanState}]`, {toFile: true});
		}
	}

	return true;
}

function PollFans() {
	//Break if were not ready to poll
	if(Date.now() - savedPollFanTimer < PollModeInternal) {
		return;
	}

	savedPollFanTimer = Date.now();

	if(device.fanControlDisabled()) {
		// Reset if the system was disbled during runtime.
		device.log("System Monitoring disabled, Clearing Connected Fans", {toFile: true});
		ConnectedFans = [];

		return;
	}

	if(ConnectedFans.length === 0){
		// Attempt to redetect connected Fans.
		// The user may have nothing connected but that is unlikely given this is primarily a fan controller
		if(!GetFanSettings()){
			device.log(`Connected Fans are still being initialized by the controller. Aborting Detection!`, {toFile: true});

			return;
		}
	}

	// Read Fan RPM
	const FanSpeeds = Corsair.FetchFanRPM();

	for(let i = 0; i < FanSpeeds.length; i++) {
		const fanRPM = FanSpeeds[i];

		if(fanRPM > 0) {
			device.log(`${FanControllerArray[i]} is running at rpm ${fanRPM}`);
		}

		device.setRPM(FanControllerArray[i], fanRPM);
	}

	// Read Temperature Probes
	// const Temperatures = Corsair.FetchTemperatures();
	// Temperatures.forEach(function (temp, iIdx) {
	// 	//device.log(`Temp ${iIdx + 1} is ${temp}C`);
	// });

	//Set Fan Speeds
	SendCoolingdata();

	device.log(`took ${Date.now() - savedPollFanTimer}ms`);
}

class StateManager{
	constructor(){
		/** @type {State[]} */
		this.states = [];
		/** @type {State?} */
		this.currentState = null;
		this.lastProcessTime = Date.now();
		this.interval = 1000;
	}
	UpdateState(){
		if (this.states.length > 0) {
			this.currentState = this.states[this.states.length - 1];
			this.interval = this.currentState.interval || 3000;
			//device.log(`Set State Interval to ${this.interval}`);
		} else {
			this.currentState = null;
		}
	}
	/**
	 * @param {State} newState
	 */
	Push(newState){
		if(!newState){
			return;
		}

		this.states.push(newState);
		this.UpdateState();
	}
	/**
	 * @param {State} newState
	 */
	Replace(newState){
		this.states.pop();
		this.Push(newState);
	}
	Pop(){
		this.states.pop();
		this.UpdateState();
	}

	Shift(){
		const state = this.states.shift();

		if(state){
			this.Push(state);
		}
	}

	process(){
		//Break if were not ready to process this state
		if(Date.now() - this.lastProcessTime < this.interval) {
			return;
		}
		const startTime = Date.now();

		if(this.currentState !== null){
			this.currentState.run();
		}

		this.lastProcessTime = Date.now();
		//device.log(`State Took [${Date.now() - startTime}]ms to process`);

	}
}
const StateMgr = new StateManager();

class State{
	/**
	 * @param {StateManager} controller
	 * @param {number} interval
	 */
	constructor(controller, interval){
		this.controller = controller;
		this.interval = interval;
	}
	run(){

	}
}
class StateSystemMonitoringDisabled extends State{
	constructor(controller){
		super(controller, 5000);
	}
	run(){
		// Clear Existing Fans
		for(const FanID of ConnectedFans){
			device.log(`Removing Fan Control: ${FanControllerArray[FanID]}`);
			device.removeFanControl(FanControllerArray[FanID]);
		}

		ConnectedFans = [];

		// Clear Existing Probes
		for(const ProbeID of ConnectedProbes){
			device.log(`Removing Temperature Probe ${ProbeID + 1}`);
			device.removeTemperatureSensor(`Temperature Probe ${ProbeID + 1}`);
		}

		ConnectedProbes = [];

		// Stay here until fan control is enabled.
		if(!device.fanControlDisabled()) {
			device.log(`Fan Control Enabled, Fetching Connected Fans...`);
			this.controller.Replace(new StateEnumerateConnectedFans(this.controller));

		}
	};
};

class StateEnumerateConnectedFans extends State{
	constructor(controller){
		super(controller, 1000);
	}
	run(){
		// Add Blocking State if fan control is disabled
		if(device.fanControlDisabled()) {
			device.log(`Fan Control Disabled...`);
			this.controller.Push(new StateSystemMonitoringDisabled(this.controller));

			return;
		}

		if(GetFanSettings()){
			device.log(`Found Connected Fans. Starting Polling Loop...`);
			this.controller.Pop();
		}else{
			device.log(`Connected Fans are still being initialized by the controller. Delaying Detection!`, {toFile: true});
			// delay next poll operation to give the device time to finish booting.
			this.interval = 5000;
		}
	};
}

class StatePollFanSpeeds extends State{
	constructor(controller){
		super(controller, 2000);
	}
	run(){
		// Add Blocking State if fan control is disabled
		if(device.fanControlDisabled()) {
			device.log(`Fan Control Disabled...`);
			this.controller.Push(new StateSystemMonitoringDisabled(this.controller));

			return;
		}

		// Add Blocking State if we have no connected fans detected
		if(ConnectedFans.length === 0){
			device.log(`No Connected Fans Known. Fetching Connected Fans... `);
			this.controller.Push(new StateEnumerateConnectedFans(this.controller));

			return;
		}

		// Read Fan RPM
		const FanSpeeds = Corsair.FetchFanRPM();

		for(let i = 0; i < FanSpeeds.length; i++) {
			const fanRPM = FanSpeeds[i];

			if(fanRPM > 0) {
				device.log(`${FanControllerArray[i]} is running at rpm ${fanRPM}`);
			}

			device.setRPM(FanControllerArray[i], fanRPM);
		}

		this.controller.Shift();

	};
};

class StatePollTempProbes extends State{
	constructor(controller){
		super(controller, 2000);
	}
	run(){
		// Add Blocking State if fan control is disabled
		if(device.fanControlDisabled()) {
			device.log(`Fan Control Disabled...`);
			this.controller.Push(new StateSystemMonitoringDisabled(this.controller));

			return;
		}

		// Read Temperature Probes
		const Temperatures = Corsair.FetchTemperatures();

		for(let i = 0; i < Temperatures.length; i++) {
			const temperature = Temperatures[i];

			if(!ConnectedProbes.includes(i)){
				ConnectedProbes.push(i);

				if(i === 0){
					device.createTemperatureSensor(`Liquid Temperature`);
					device.log(`Found Liquid Temperature Sensor on Port ${i + 1}`, {toFile: true});
				}else{
					device.createTemperatureSensor(`Temperature Probe ${i + 1}`);
					device.log(`Found Temperature Sensor on Port ${i + 1}`, {toFile: true});

				}
			}

			if(i === 0){
				device.SetTemperature(`Liquid Temperature`, temperature);
				device.log(`Liquid Temperature is at ${temperature}C`);
			}else{
				device.SetTemperature(`Temperature Probe ${i + 1}`, temperature);
				device.log(`Temperature Probe ${i+1} is at ${temperature}C`);

			}

		}

		this.controller.Shift();

	};
};

class StateSetFanSpeeds extends State{
	constructor(controller){
		super(controller, 2000);
	}
	run(){
		// Add Blocking State if fan control is disabled
		if(device.fanControlDisabled()) {
			device.log(`Fan Control Disabled...`);
			this.controller.Push(new StateSystemMonitoringDisabled(this.controller));

			return;
		}

		// Add Blocking State if we have no connected fans detected
		if(ConnectedFans.length === 0){
			device.log(`No Connected Fans Known. Fetching Connected Fans... `);
			this.controller.Push(new StateEnumerateConnectedFans(this.controller));

			return;
		}

		//Set Fan Speeds
		SendCoolingdata();

		this.controller.Shift();

	};
};

//0x00, 0x08, 0x06, 0x01, 0x1F, 0x00, 0x00, 0x00,
function SendCoolingdata() {

	const CoolingData = [
		0x07, 0x00, 0x07,
		0x00, 0x00, 0x32, 0x00,
		0x01, 0x00, 0x32, 0x00,
		0x02, 0x00, 0x32, 0x00,
		0x03, 0x00, 0x32, 0x00,
		0x04, 0x00, 0x32, 0x00,
		0x05, 0x00, 0x32, 0x00,
		0x06, 0x00, 0x32, 0x00,
	];

	for(let fan = 0; fan < ConnectedFans.length; fan++) {
		//const fanLevel = (device.getNormalizedFanlevel(FanControllerArray[ConnectedFans[fan]]) * 100).toFixed(0);
		let fanLevel = device.getFanlevel(FanControllerArray[ConnectedFans[fan]]);

		// Prevent pump from going below 60%
		// Doing this on newer models will put the device into a failsafe mode until power cycled.
		if(fan === 0 && PumpConnected){ //PumpConnected is a check to handle users with a CoCo but no Capellix. Needs Thorough testing.
			fanLevel = Math.max(60, fanLevel);
		}

		device.log(`${FanControllerArray[ConnectedFans[fan]]} level set to ${fanLevel}%`);

		CoolingData[5 + ConnectedFans[fan] * 4] = fanLevel;
	}


	Corsair.WriteEndpoint("Background", Corsair.Endpoints.FanSpeeds, CoolingData);

}

function decimalToHex(d, padding) {
	let hex = Number(d).toString(16);
	padding = typeof (padding) === "undefined" || padding === null ? padding = 2 : padding;

	while (hex.length < padding) {
		hex = "0" + hex;
	}

	return "0x" + hex;
}
/**
 * @typedef Options
 * @type {Object}
 * @property {string=} developmentFirmwareVersion
 * @property {boolean=} IsLightingController
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
 * Major concepts are {@link ModernCorsairProtocol#Properties|Properties} and {@link ModernCorsairProtocol#Handles|Handles}/{@link ModernCorsairProtocol#Endpoints|Endpoints}.
 *
 */
export class ModernCorsairProtocol{


	/** @constructs
	 * @param {Options} options - Options object containing device specific configuration values
	 */
	constructor(options = {}) {
		this.DeviceBufferSize = 1280;
		this.ConfiguredDeviceBuffer = false;

		/**
		 * @property {boolean} IsLightingController - Used to determine if lighting data is formated in a RGBRGBRGB format
		 * @property {string} developmentFirmwareVersion - Used to track the firmware version the plugin was developed with to the one on a users device
		 * @property {number} LedChannelSpacing - Used to seperate color channels on non-lighting controller devices.
		 */
		this.config = {
			IsLightingController: typeof options.IsLightingController === "boolean" ? options.IsLightingController : false,
			developmentFirmwareVersion: typeof options.developmentFirmwareVersion === "string" ? options.developmentFirmwareVersion : "Unknown",
			LedChannelSpacing: typeof options.LedChannelSpacing === "number" ? options.LedChannelSpacing : 0,
		};

		this.KeyCodes = [];
		this.KeyCount = 0;

		/**
		 * Connection Types for Wired vs Wireless connection types. This must be set to match the physical device's connection or all commands will be rejected by the device.
		 * @readonly
		 * @enum {number}
		 * @property {0x08} WiredCommand - Used for Commands when the device has a Wired connection
		 * @property {0x09} WirelessCommand - Used for Commands when the device has a Wireless connection
		 */
		this.ConnectionTypes = Object.freeze({
			WiredCommand: 0x08,
			WirelessCommand: 0x09
		});
		this.ConnectionType = this.ConnectionTypes.WiredCommand;

		/**
		 * @readonly
		 * @static
		 * @enum {number}
		 * @property {0x01} setProperty - Used to set a {@link ModernCorsairProtocol#Properties|Property} value on the device
		 * @property {0x02} getProperty - Used to fetch a {@link ModernCorsairProtocol#Properties|Property} value from the device
		 * @property {0x05} closeHandle - Used to close a device {@link ModernCorsairProtocol#Handles|Handle}
		 * @property {0x06} writeEndpoint - Used to write data to an opened device {@link ModernCorsairProtocol#Endpoints|Endpoint}.
		 * @property {0x07} streamEndpoint - Used to stream data to an opened device {@link ModernCorsairProtocol#Endpoints|Endpoint} if the data cannot fit within one packet
		 * @property {0x08} readEndpoint - Used to read data (i.e Fan Speeds) from a device {@link ModernCorsairProtocol#Endpoints|Endpoint}
		 * @property {0x09} checkHandle - Used to check the status of a device {@link ModernCorsairProtocol#Endpoints|Endpoint}. Returned data is currently unknown
		 * @property {0x0D} openEndpoint - Used to open an Endpoint on a device {@link ModernCorsairProtocol#Handles|Handle}
		 * @property {0x12} pingDevice - Used to ping the device for it's current connection status
		 * @property {0x15} confirmChange - Used to apply led count changes to Commander Core [XT]
		 */
		this.CommandIds = Object.freeze({
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
		 * @enum {number}
		 * @property {0x01} - Hardware Mode
		 * @property {0x02} - Software Mode
		 */
		this.Modes = Object.freeze({
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
		 * @property {0x21} dpiX Device's Current X DPI PropertyID
		 * @property {0x22} dpiY Device's Current Y DPI PropertyID.
		 * @property {0x37} idleModeTimeout Device's Idle Timeout PropertyId. Value is in Milliseconds and has a max of 99 Minutes.
		 * @property {0x41} layout Device's Physical Layout PropertyId. Only applies to Keyboards.
		 * @property {0x44} BrightnessLevel Coarse (0-3) Brightness. Effectively sets brightness in 33.33% increments.
		 * @property {0x45} WinLockState Device's WinKey Lock Status. Only applies to Keyboards.
		 * @property {0x4A} LockedShortcuts Device's WinKey Lock Bit flag. Governs what key combinations are disabled by the devices Lock mode. Only Applies to Keyboards.
		 * @property {0x96} maxPollingRate Device's Max Polling Rate PropertyId. Not supported on all devices.
		 * @property {0xB0} ButtonResponseOptimization
		 */

		this.Properties =  Object.freeze({
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
			dpiX: 0x21,
			dpiY: 0x22,
			idleModeTimeout: 0x37,
			layout: 0x41,
			BrightnessLevel: 0x44,
			WinLockState: 0x45,
			LockedShortcuts: 0x4A,
			maxPollingRate: 0x96,
			ButtonResponseOptimization: 0xB0,
		});

		this.PropertyNames = Object.freeze({
			0x01: "Polling Rate",
			0x02: "HW Brightness",
			0x03: "Mode",
			0x07: "Angle Snapping",
			0x0d: "Idle Mode",
			0x0F: "Battery Level",
			0x10: "Battery Status",
			0x11: "Vendor Id",
			0x12: "Product Id",
			0x13: "Firmware Version",
			0x1E: "DPI Profile",
			0x1F: "DPI Mask",
			0x21: "DPI X",
			0x22: "DPI Y",
			0x37: "Idle Mode Timeout",
			0x41: "HW Layout",
			0x96: "Max Polling Rate",
		});

		/**
		 * Contains the EndpointId's of all known Endpoints. These handle advanced device functions like Lighting and Fan Control.
		 * To manually interact with these you must open a Handle to the Endpoint first using {@link ModernCorsairProtocol#OpenHandle|OpenHandle(HandleId, EndpointId)}.
		 *
		 * Helper Functions to interact with these exist as the following:
		 * <ul style="list-style: none;">
		 * <li> {@link ModernCorsairProtocol#WriteEndpoint|WriteEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#ReadEndpoint|ReadEndpoint(HandleId, EndpointId, CommandId)}
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
		this.Endpoints = Object.freeze({
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

		this.EndpointNames = Object.freeze({
			0x01: "Lighting",
			0x02: "Buttons",
			0x17: "Fan RPMs",
			0x08: "Fan Speeds",
			0x1A: "Fan States",
			0x1D: "3Pin Led Count",
			0x1E: "4Pin Led Count",
			0x21: "Temperature Probes",
			0x22: "Lighting Controller",
		});

		this.ChargingStates = Object.freeze({
			1: "Charging",
			2: "Discharging",
			3: "Fully Charged",
		});


		this.ResponseIds = Object.freeze({
			firmware: 0x02,
			command: 0x06,
			openEndpoint: 0x0D,
			closeEndpoint: 0x05,
			getRpm: 0x06,
			fanConfig: 0x09,
			temperatureData: 0x10,
			LedConfig: 0x0F,
		});

		/**
		 * Contains the HandleId's of usable device Handles. These are used to open internal device {@link ModernCorsairProtocol#Endpoints|Endpoint} foradvanced functions like Lighting and Fan Control.
		 * Each Handle can only be open for one {@link ModernCorsairProtocol#Endpoints|Endpoint} at a time, and must be closed before the {@link ModernCorsairProtocol#Endpoints|Endpoint} can be changed.
		 * For best practice all non-lighting Handles should be closed immediately after you are done interacting with it.
		 *
		 * Auxiliary (0x02) Should only be needed in very specific cases.
		 *
		 * Helper Functions to interact with these exist as the following:
		 * <ul style="list-style: none;">
		 * <li> {@link ModernCorsairProtocol#WriteEndpoint|WriteEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#ReadEndpoint|ReadEndpoint(HandleId, EndpointId, CommandId)}
		 * <li> {@link ModernCorsairProtocol#CloseHandle|CloseHandle(HandleId)}
		 * <li> {@link ModernCorsairProtocol#CheckHandle|CheckHandle(HandleId)}
		 * </ul>
		 */
		this.Handles = Object.freeze({
			Lighting: 0x00,
			Background: 0x01,
			Auxiliary: 0x02,
		});

		this.HandleNames = Object.freeze({
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
		this.FanStates = Object.freeze({
			Disconnected: 0x01,
			Initializing: 0x04,
			Connected: 0x07,
		});

		this.FanTypes = Object.freeze({
			QL: 0x06,
			SpPro: 0x05
		});

		this.PollingRates = Object.freeze({
			1: "125hz",
			2: "250hz",
			3: "500hz",
			4: "1000hz",
			5: "2000hz",
		});

		this.PollingRateNames = Object.freeze({
			"125hz": 1,
			"250hz": 2,
			"500hz": 3,
			"1000hz": 4,
			"2000hz": 5,
		});

		this.Layouts = Object.freeze({
			0x01: "ANSI",
			"ANSI" : 0x01,
			0x02: "ISO",
			"ISO": 0x02
		});

		this.KeyStates = Object.freeze({
			Disabled: 0,
			0: "Disabled",
			Enabled: 1,
			1: "Enabled",
		});
	}


	GetNameOfHandle(Handle){
		if(this.HandleNames.hasOwnProperty(Handle)){
			return this.HandleNames[Handle];
		}

		return "Unknown Handle";
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
	PingDevice(){
		let packet = [0x00, this.ConnectionType, this.CommandIds.pingDevice];
		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		if(packet[2] !== 0x12){
			return false;
		}

		return true;
	}

	SetKeyStates(Enabled){
		this.KeyCodes = [];

		// Assuming a continuous list of key id's
		for(let iIdx = 0; iIdx < this.KeyCount; iIdx++){
			this.KeyCodes.push(Enabled);
		}

		this.WriteEndpoint("Background", this.Endpoints.Buttons, this.KeyCodes);
	}

	SetSingleKey(KeyID, Enabled){
		this.KeyCodes[KeyID - 1] = Enabled;

		this.WriteEndpoint("Background", this.Endpoints.Buttons, this.KeyCodes);
	}

	/**
	 * This function can be used to manually set the devices buffer length instead of attempting auto detection. This value must be set for any other functions in this Protocol to work.
	 * @param {number} BufferSize Desired buffer size in bytes.
	 */
	SetDeviceBufferSize(BufferSize){
		this.DeviceBufferSize = BufferSize;
		this.ConfiguredDeviceBuffer = true;
	}
	/** Calling this function to get the write/read length will auto detect it the first time its needed if it hasn't been detected yet.*/
	GetBufferSize(){
		if(!this.ConfiguredDeviceBuffer){
			this.FindBufferLength();
		}

		return this.DeviceBufferSize;
	}
	/**
	 * Finds and sets the device's buffer size for internal use within the Protocol. This should be the first function called when using this Protocol class as all other interactions with the device rely on the buffer size being set properly.
	 *
	 * This is automatically called on the first write operation, or can be set manually by {@link ModernCorsairProtocol#SetDeviceBufferSize|SetDeviceBufferSize(BufferSize)}.
	 */
	FindBufferLength(){
		if(this.DeviceBufferSize === 1280 || !this.ConfiguredDeviceBuffer){
			this.log(`Device Buffer Length Unknown. Attempting to read it from device!`);

			// Using a proxy Device Ping request to get a packet to read. Write length is a placeholder value as we're relying on HidAPI
			// to sort out the proper write length.
			device.write([0x00, this.ConnectionType, this.CommandIds.pingDevice], 1024);
			device.read([0x00], 1024);

			const ReadLength = device.getLastReadSize();

			if(ReadLength !== 0){
				this.DeviceBufferSize = ReadLength;
				this.log(`Buffer length set to ${this.DeviceBufferSize}`);
				this.ConfiguredDeviceBuffer = true;

				return;
			}

			this.log(`Failed to read from the device. We'll attempt to refetch write/read lengths later...`);
		}
	}
	/**
	 * Helper function to read and properly format the device's firmware version.
	 */
	FetchFirmware(){
		const data = this.ReadProperty(this.Properties.firmware);

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
	SetDPI(DPI){
		const CurrentDPI = this.FetchProperty("DPI X");

		if(CurrentDPI !== DPI){

			device.log(`Current device DPI is [${CurrentDPI}], Desired value is [${DPI}]. Setting DPI!`);
			this.SetProperty(this.Properties.dpiX, DPI);
			this.SetProperty(this.Properties.dpiY, DPI);

			device.log(`DPI X is now [${this.FetchProperty(this.Properties.dpiX)}]`);
			device.log(`DPI Y is now [${this.FetchProperty(this.Properties.dpiX)}]`);
		}
	}

	/**
	 * Helper function to grab the devices battery level and charge state. Battery Level is on a scale of 0-1000.
	 * @returns [number, number] An array containing [Battery Level, Charging State]
	 */
	FetchBatteryStatus(){
		const BatteryLevel = this.FetchProperty(this.Properties.batteryLevel);
		const ChargingState = this.FetchProperty(this.Properties.batteryStatus);

		return [BatteryLevel, ChargingState];
	}
	/**
	 *
	 * @param {number[]} Data - Data packet read from the device.
	 * @param {string} Context - String representing the calling location.
	 * @returns {number} An Error Code if the Data packet contained an error, otherwise 0.
	 */
	CheckError(Data, Context){
		const hasError = Data[3] ?? false;

		if(!hasError){
			return hasError;
		}

		const caller_line = (new Error).stack.split("\n")[2];
		const caller_function = caller_line.slice(0, caller_line.indexOf("@"));
		const line_number = caller_line.slice(caller_line.lastIndexOf(":")+1);
		const caller_context = `${caller_function}():${line_number}`;

		switch(Data[3]){
		case 1: // Invalid Value
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Invalid Value Set!`);
			break;

		case 3: // Endpoint Error
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Operation Failed!`);
			break;

		case 5: // Property Not Supported
			device.log(`${caller_context} CorsairProtocol Error [${hasError}]: Property is not supported on this device!`);
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
	 * 	@param {number|string} PropertyId Property Index to be checked and set on the device. This value can either be the {@link ModernCorsairProtocol#Properties|PropertyId}, or the readable string version of it.
	 * 	@param {number} Value The Value to be checked against and set if the device's value doesn't match.
	 *  @return {boolean} a Boolean on if the Property value on the device did match, or now matches the value desired.
	 */
	CheckAndSetProperty(PropertyId, Value){
		if(typeof PropertyId === "string"){
			PropertyId = getKeyByValue(this.PropertyNames, PropertyId);
		}

		const CurrentValue = this.FetchProperty(PropertyId);

		if(CurrentValue !== Value){
			device.log(`Device ${this.PropertyNames[PropertyId]} is currently [${CurrentValue}]. Desired Value is [${Value}]. Setting Property!`);

			this.SetProperty(PropertyId, Value);
			device.read([0x00], this.GetBufferSize(), 5);

			const NewValue = this.FetchProperty(PropertyId);
			device.log(`Device ${this.PropertyNames[PropertyId]} is now [${NewValue}]`);

			return NewValue === Value;
		}

		return true;
	}

	/**
	 * Reads a property from the device and returns the joined value after combining any high/low bytes. This function can return a null value if it's unable to read the property; i.e. it's unavailable on this device.
	 * @param {number | string } PropertyId Property Index to be read from the device. This value can either be the {@link ModernCorsairProtocol#Properties|PropertyId}, or the readable string version of it.
	 * @returns The joined value, or undefined if the device fetch failed.
	 */
	FetchProperty(PropertyId) {
		if(typeof PropertyId === "string"){
			PropertyId = getKeyByValue(this.PropertyNames, PropertyId);
		}

		const data = this.ReadProperty(PropertyId);

		// Don't return error codes.
		if(data.length === 0){
			return -1;
		}

		return Convert_To_16Bit(data.slice(4, 7));
	}

	/**
	 * Attempts to sets a property on the device and returns if the operation was a success.
	 * @param {number|string} PropertyId Property Index to be written to on the device. This value can either be the {@link ModernCorsairProtocol#Properties|PropertyId}, or the readable string version of it.
	 * @param {number} Value The Value to be set.
	 * @returns 0 on success, otherwise an error code from the device.
	 */
	SetProperty(PropertyId, Value) {
		if(typeof PropertyId === "string"){
			PropertyId = getKeyByValue(this.PropertyNames, PropertyId);
		}

		let packet = [0x00, this.ConnectionType, this.CommandIds.setProperty, PropertyId, 0x00, (Value & 0xFF), (Value >> 8 & 0xFF), (Value >> 16 & 0xFF)];
		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		const ErrorCode = this.CheckError(packet, `SetProperty`);

		if(ErrorCode === 1){
			device.log(`Failed to set Property [${this.PropertyNames[PropertyId]}, ${decimalToHex(PropertyId, 2)}]. [${Value}] is an Invalid Value`);

			return ErrorCode;
		}

		if(ErrorCode === 3){
			device.log(`Failed to set Property [${this.PropertyNames[PropertyId]}, ${decimalToHex(PropertyId, 2)}]. Are you sure it's supported?`);

			return ErrorCode;
		}

		if(ErrorCode === 9){
			device.log(`Failed to set Property [${this.PropertyNames[PropertyId]}, ${decimalToHex(PropertyId, 2)}]. The device says this is a read only property!`);

			return ErrorCode;
		}

		return 0;
	}

	/**
	 * Reads a property from the device and returns the raw packet.
	 * @param {number} PropertyId Property Index to be read from the device.  This value can either be the {@link ModernCorsairProtocol#Properties|PropertyId}, or the readable string version of it.
	 * @returns The packet data read from the device.
	 */
	ReadProperty(PropertyId) {
		//Clear read buffer
		do{
			device.read([0x00], 65, 3);
		}while(device.getLastReadSize() > 0);

		let packet = [0x00, this.ConnectionType, this.CommandIds.getProperty, PropertyId, 0x00];
		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		const ErrorCode = this.CheckError(packet, `ReadProperty`);

		if(ErrorCode){
			device.log(`Failed to read Property [${this.PropertyNames[PropertyId]}, ${decimalToHex(PropertyId, 2)}]. Are you sure it's supported?`);

			return [];
		}

		return packet;
	}

	/**
	 * Opens a Endpoint on the device. Only one Endpoint can be open on a Handle at a time so if the handle is already open this function will fail.
	 * @param {Handle} Handle The Handle to open the Endpoint on. Default is 0.
	 * @param {number} Endpoint Endpoint Address to be opened.
	 * @returns 0 on success, otherwise an error code from the device.
	 */
	OpenHandle(Handle, Endpoint) {
		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}
		let packet = [0x00, this.ConnectionType, this.CommandIds.openEndpoint, Handle, Endpoint];
		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		const ErrorCode = this.CheckError(packet, `OpenEndpoint`);

		if(ErrorCode){
			device.log(`Failed to open Endpoint [${this.EndpointNames[Endpoint]}, ${decimalToHex(Endpoint, 2)}] on Handle [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. Are you sure it's supported and wasn't already open?`);
		}

		return ErrorCode;
	}
	/**
	 * Closes a Handle on the device.
	 * @param {Handle} Handle The HandleId to Close.
	 * @returns 0 on success, otherwise an error code from the device.
	 */
	CloseHandle(Handle) {
		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}
		let packet = [0x00, this.ConnectionType, this.CommandIds.closeHandle, 1, Handle];
		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		const ErrorCode = this.CheckError(packet, `CloseEndpoint`);

		if(ErrorCode){
			device.log(`Failed to close Handle [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. was it even open?`);
		}

		return ErrorCode;
	}
	/**
	 * Helper function to Check the Handle is currently open and closes it if it is.
	 * @param {Handle} Handle - HandleId to perform the check on.
	 */
	CloseHandleIfOpen(Handle){
		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}

		if(this.IsHandleOpen(Handle)){
			device.log(`${this.GetNameOfHandle(Handle)} Handle is open. Closing...`);
			this.CloseHandle(Handle);
		}
	}

	/**
	 * Performs a Check Command on the HandleId given and returns whether the handle is open.
	 * @param {Handle} Handle - HandleId to perform the check on.
	 * @returns {Boolean} Boolean representing if the Handle is already open.
	 */
	IsHandleOpen(Handle){
		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}

		ClearReadBuffer(1);

		let packet = [0x00, this.ConnectionType, this.CommandIds.checkHandle, Handle, 0x00];

		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		const isOpen = packet[3] !== 3;

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
	CheckHandle(Handle){
		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}
		let packet = [0x00, this.ConnectionType, this.CommandIds.checkHandle, Handle, 0x00];
		device.write(packet, this.GetBufferSize());
		packet = device.read(packet, this.GetBufferSize());

		const ErrorCode = this.CheckError(packet, `CheckHandle`);

		if(ErrorCode){
			this.CloseHandle(Handle);
			device.log(`Failed to check Handle [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. Did you open it?`);

			return ErrorCode;
		}

		return packet;
	}
	/**
	 * This Helper Function will Open, Read, and Close a device Handle for the Endpoint given.
	 * If the read packet does not contain the ResponseId given the packet will be reread up to 4 times before giving up and returning the last packet read.
	 * If the Handle given is currently open this function will close it and then re-attempt opening it.
	 * @param {Handle} Handle - Handle to be used.
	 * @param {number} Endpoint - Endpoint to be read from
	 * @param {number} Command - CommandId that is contained in the return packet to verify the correct packet was read from the device.
	 * @returns The entire packet read from the device.
	 */
	ReadEndpoint(Handle, Endpoint, Command) {


		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}

		if(this.IsHandleOpen(Handle)){
			device.log(`CorsairProtocol: Handle is already open: [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. Attemping to close...`);
			this.CloseHandle(Handle);
		}

		const ErrorCode = this.OpenHandle(Handle, Endpoint);


		if(ErrorCode){
			this.CloseHandle(Handle);
			device.log(`CorsairProtocol: Failed to open Device Handle [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. Aborting ReadEndpoint operation.`);

			return [];
		}

		device.write([0x00, this.ConnectionType, this.CommandIds.readEndpoint, Handle], this.GetBufferSize());

		let Data = [];
		Data = device.read([0x00], this.GetBufferSize());


		let RetryCount = 4;

		do {
			RetryCount--;
			device.write([0x00, this.ConnectionType, this.CommandIds.readEndpoint, Handle], this.GetBufferSize());
			Data = device.read(Data, this.GetBufferSize());

			if(this.ResponseIds[Data[4]] !== this.ResponseIds[Command]) {
				device.log(`Invalid Command Read: Got [${this.ResponseIds[Data[2]]}][${Data[4]}], Wanted [${this.ResponseIds[Command]}][${Command}]`);
			}

		} while(this.ResponseIds[Data[4]] !== this.ResponseIds[Command] && RetryCount > 0);

		this.CloseHandle(Handle);

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
	WriteEndpoint(Handle, Endpoint, Data) {
		if(typeof Handle === "string"){
			Handle = this.Handles[Handle];
		}

		if(this.IsHandleOpen(Handle)){
			device.log(`CorsairProtocol: Handle is already open: [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. Attemping to close...`);

			this.CloseHandle(Handle);
		}

		let ErrorCode = this.OpenHandle(Handle, Endpoint);

		if(ErrorCode){
			device.log(`CorsairProtocol: Failed to open Device Handle [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}]. Aborting WriteEndpoint operation.`);

			return ErrorCode;
		}

		let packet = [0x00, this.ConnectionType, this.CommandIds.writeEndpoint, Handle, Data.length & 0xff, (Data.length >> 8) & 0xFF, 0x00, 0x00];
		packet.push(...Data);

		device.write(packet, this.GetBufferSize());
		// Extra read to skip an empty packet.
		//device.read([0x00], this.GetBufferSize(), 5);

		packet = device.read([0x00], this.GetBufferSize());

		ErrorCode = this.CheckError(packet, `WriteEndpoint`);

		if(ErrorCode){
			device.log(`Failed to Write to Handle [${this.GetNameOfHandle(Handle)}, ${decimalToHex(Handle, 2)}].`);
		}

		this.CloseHandle(Handle);

		return ErrorCode;
	}
	/**
	 * This Helper Function to write RGB data to the device. This function will split the data into as many packets as needed and do multiple WriteEndpoints(Handle, Endpoint, Data) based on the DeviceBufferSize set.
	 *
	 * This function expects the Lighting HandleId (0x00) to already be open.
	 *
	 * This function will handle setting the header data expected by the device. If the RGBData Array Length provided doesn't match what the devices Lighting Endpoint expects this command will Error.
	 *
	 * @param {number[]} RGBData - RGBData to be written to the device in a RRRGGGBBB(Lighting Endpoint 0x01) or RGBRGBRGB(LightingController Endpoint 0x22) format.
	 */
	SendRGBData(RGBData){
		const InitialHeaderSize = 8;
		const HeaderSize = 4;
		let BytesSent = 0;

		// All packets sent to the LightingController Endpoint have these 2 values added before any other data.
		if(this.config.IsLightingController){
			RGBData.splice(0, 0, ...[0x12, 0x00]);
		}

		let TotalBytes = RGBData.length;
		const InitialPacketSize = this.GetBufferSize() - InitialHeaderSize;

		this.WriteLighting(RGBData.length, RGBData.splice(0, InitialPacketSize));

		TotalBytes -= InitialPacketSize;
		BytesSent += InitialPacketSize;

		while(TotalBytes > 0){
			const BytesToSend = Math.min(this.GetBufferSize() - HeaderSize, TotalBytes);
			this.StreamLighting(RGBData.splice(0, BytesToSend));

			TotalBytes -= BytesToSend;
			BytesSent += BytesToSend;
		}
	}
	/** @private */
	WriteLighting(LedCount, RGBData){

		const packet = [];
		packet[0x00] = 0x00;
		packet[0x01] = this.ConnectionType;
		packet[0x02] = this.CommandIds.writeEndpoint;
		packet[0x03] = 0x00;
		packet[0x04] = (LedCount) & 0xFF;
		packet[0x05] = (LedCount) >> 8;
		packet[0x06] = 0x00;
		packet[0x07] = 0x00;

		packet.push(...RGBData);

		device.write(packet, this.GetBufferSize());

		const response = device.read([0x00], this.GetBufferSize());

		this.CheckError(response, "WriteLighting");
	}

	/** @private */
	StreamLighting(RGBData) {

		const packet = [];
		packet[0x00] = 0x00;
		packet[0x01] = this.ConnectionType;
		packet[0x02] = this.CommandIds.streamEndpoint;
		packet[0x03] = 0x00;
		packet.push(...RGBData);

		device.write(packet, this.GetBufferSize());

		const response = device.read([0x00], this.GetBufferSize());

		this.CheckError(response, "StreamLighting");
	}

	/**
	 * Helper Function to Fetch and Set the devices mode. This function will close all currently open Handles on the device to ensure a clean slate and to prevent issues interacting with the device.
	 * Closing Handles in this function leads to iCUE not being able to function anymore, but solves issues with us not being able to find an open handle when trying to access non-lighting endpoints.
	 * @param {number | "Hardware" | "Software"} Mode ModeId to be checks against and set on the device.
	 */
	SetMode(Mode){
		if(typeof Mode === "string"){
			Mode = this.Modes[Mode];
		}

		let CurrentMode = this.FetchProperty(this.Properties.mode);

		// if going into hardware mode we want to close all handles.
		// if going into software mode we don't want any handles stuck open from Icue or the file watchdog trigger.
		this.CloseHandleIfOpen("Lighting");
		this.CloseHandleIfOpen("Background");
		this.CloseHandleIfOpen("Auxiliary");

		if(CurrentMode !== Mode) {
			device.log(`Setting Device Mode to ${this.Modes[Mode]}`);
			this.SetProperty(this.Properties.mode, Mode);
			CurrentMode = this.FetchProperty(this.Properties.mode);
			device.log(`Mode is now ${this.Modes[CurrentMode]}`);
		}
	}

	/**
	 * Helper function to set the Hardware level device brightness if it is different then the Brightness value provided. This property is saved to flash.
	 * @param {number} Brightness Brightness Value to be set in the range of 0-1000
	 */
	SetHWBrightness(Brightness){
		const HardwareBrightness = this.FetchProperty(this.Properties.brightness);

		if(HardwareBrightness !== Brightness){
			device.log(`Hardware Level Brightness is ${HardwareBrightness/10}%`);

			this.SetProperty(this.Properties.brightness, Brightness);

			// Setting brightness appears to queue 2 packets to be read from the device
			// instead of the expected one.
			this.ReadProperty(this.Properties.brightness);

			device.log(`Hardware Level Brightness is now ${this.FetchProperty(this.Properties.brightness)/10}%`);
		}
	}

	/**
	 * Helper function to set the device's angle snapping if it is difference then the bool provided. This property is saved to flash.
	 * @param {boolean} AngleSnapping boolean Status to be set for Angle Snapping.
	 */
	SetAngleSnapping(AngleSnapping){
		const HardwareAngleSnap =  this.FetchProperty(this.Properties.angleSnap);

		if(HardwareAngleSnap !== AngleSnapping){
			device.log(`Device Angle Snapping is set to [${HardwareAngleSnap ? "True" : "False"}]`);

			this.SetProperty(this.Properties.angleSnap, AngleSnapping);

			const NewAngleSnap = this.FetchProperty(this.Properties.angleSnap);
			device.log(`Device Angle Snapping is now [${NewAngleSnap ? "True" : "False"}]`);
		}
	}

	/** */
	FetchFanRPM() {
		//device.log("CorsairProtocol: Reading Fan RPM's.");

		if(device.fanControlDisabled()) {
			device.log("Fan Control is Disabled! Are you sure you want to try this?");

			return [];
		}

		const data = this.ReadEndpoint("Background", this.Endpoints.FanRPM, 0x06);

		if(data.length === 0){
			device.log(`CorsairProtocol: Failed To Read Fan RPM's.`);

			return [];
		}

		const FanSpeeds = [];

		if(data[4] !== 6 && data[5] !== 0) {
			device.log("Failed to get Fan RPM's");
		}
		const fanCount = data[6];
		//device.log(`CorsairProtocol: Device Reported [${fanCount}] Fan RPM's`);


		const fanSpeeds = data.slice(7, 7 + 2 * fanCount);

		for(let i = 0; i < fanCount; i++) {
			const fanData = fanSpeeds.splice(0, 2);
			const fanRPM = fanData[0] + (fanData[1] << 8);

			FanSpeeds[i] = fanRPM;
		}

		return FanSpeeds;
	}
	/** */
	FetchFanStates() {
		//device.log("CorsairProtocol: Reading Fan States.");

		// if(device.fanControlDisabled()) {
		// 	device.log("Fan Control is Disabled! Are you sure you want to try this?");

		// 	return [];
		// }

		const data = this.ReadEndpoint("Background", this.Endpoints.FanStates, 0x09);

		if(data.length === 0){
			device.log(`CorsairProtocol: Failed To Read Fan States.`);

			return [];
		}

		if(data[4] !== 9 || data[5] !== 0) {
			device.log("Failed to get Fan Settings", {toFile: true});

			return [];
		}

		const FanCount = data[6];
		//device.log(`CorsairProtocol: Device Reported [${FanCount}] Fans`);

		const FanData = data.slice(7, 7 + FanCount);

		return FanData;
	}
	/** */
	SetFanType() {
		// Configure Fan Ports to use QL Fan size grouping. 34 Leds
		const FanSettings = [0x00, 0x08, 0x06, 0x01, 0x11, 0x00, 0x00, 0x00, 0x0D, 0x00, 0x07];
		const offset = 11;

		for(let iIdx = 0; iIdx < 7; iIdx++) {
			FanSettings[offset + iIdx * 2] = 0x01;
			FanSettings[offset + iIdx * 2 + 1] = iIdx === 0 ? 0x01 : this.FanTypes.QL; // 1 for nothing, 0x08 for pump?
		}

		this.OpenHandle("Background", this.Endpoints.LedCount_4Pin);

		device.write(FanSettings, this.GetBufferSize());
		device.read([0x00], this.GetBufferSize());

		this.CloseHandle("Background");

		//sendPacketString("00 08 15 01", Device_Write_Length); //apply changes
	}
	/** */
	FetchTemperatures() {
		//device.log(`CorsairProtocol: Reading Temp Data.`);

		const data = this.ReadEndpoint("Background", this.Endpoints.TemperatureData, 0x16);

		if(data.length === 0){
			device.log(`CorsairProtocol: Failed To Read Temp Data.`);

			return [];
		}

		const ProbeTemps = [];

		if(data[4] === this.ResponseIds.temperatureData && data[5] === 0) {
			const ProbeCount = data[6];
			//device.log(`CorsairProtocol: Device Reported [${ProbeCount}] Temperature Probes`);

			const TempValues = data.slice(7, 7 + 3 * ProbeCount);

			for(let i = 0; i < data[6]; i++) {
				const probe = TempValues.slice(i * 3 + 1, i * 3 + 3);
				const temp = Convert_To_16Bit(probe) / 10;

				ProbeTemps[i] = temp;
			}
		}

		return ProbeTemps;
	}
}

const Corsair = new ModernCorsairProtocol(options);

// Helper Functions
/**
 *
 * @param {number}timeout
 */
function ClearReadBuffer(timeout = 10){
	let count = 0;
	let LastRead = 1;

	while(LastRead > 0){
		device.read([0x00], 17, timeout);

		LastRead = device.getLastReadSize();
		count++;
	}

	// if(count > 1){
	// 	device.log(`Cleared ${count} Read Packets!`);
	// }
}

function Convert_To_16Bit(values) {
	let returnValue = 0;

	for(let i = 0; i < values.length; i++) {
		returnValue += values[i] << (8 * i);
	}

	return returnValue;
}

function Convert_From_16Bit(value, LittleEndian = false) {
	const returnValue = [];

	while(value > 0){
		returnValue.push(value & 0xFF);
		value = value >> 8;
	}

	return LittleEndian ? returnValue : returnValue.reverse();
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

export function ImageUrl() {
	return "https://assets.signalrgb.com/devices/brands/corsair/controllers/commander-core.png";
}

const EliteLCDCooler = {
	positioning: [
		[6, 0],
		[5, 1],
		[7, 1],
		[4, 2],
		[8, 2],
		[3, 3],
		[9, 3],
		[2, 4],
		[10, 4],
		[1, 5],
		[11, 5],
		[0, 6],
		[12, 6],
		[1, 7],
		[11, 7],
		[2, 8],
		[10, 8],
		[4, 10],
		[8, 10],
		[3, 9],
		[9, 9],
		[5, 11],
		[7, 11],
		[6, 12]
	],
	mapping: [
		6,
		5, 7,
		4, 8,
		3, 9,
		2, 10,
		1, 11,
		0, 12,
		23, 13,
		22, 14,
		21, 15,
		20, 16,
		19, 17,
		18
	],
	LedNames: [
		"Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10", "Led 11", "Led 12", "Led 13", "Led 14", "Led 15", "Led 16",
		"Led 17", "Led 18", "Led 19", "Led 20", "Led 21", "Led 22", "Led 23", "Led 24"
	],
	displayName: "Elite LCD Cooler",
	ledCount: 24,
	width: 13,
	height: 13,
	image: "https://assets.signalrgb.com/devices/brands/corsair/aio/lcd.png"
};

const EliteCapellixCooler = {
	positioning: [
		[0, 0],
		[2, 0],
		[4, 0],
		[6, 0],
		[1, 1],
		[3, 1],
		[5, 1],
		[0, 2],
		[2, 2],
		[3, 2],
		[4, 2],
		[6, 2],
		[1, 3],
		[2, 3],
		[3, 3],
		[4, 3],
		[5, 3],
		[0, 4],
		[2, 4],
		[3, 4],
		[4, 4],
		[6, 4],
		[1, 5],
		[3, 5],
		[5, 5],
		[0, 6],
		[2, 6],
		[4, 6],
		[6, 6]
	],
	mapping: [
		28, 27, 26, 25,
		16, 15, 14,
		17, 0, 7, 3, 24,
		9, 4, 8, 6, 13,
		18, 1, 5, 2, 23,
		10, 11, 12,
		19, 20, 21, 22
	],
	LedNames: [
		"Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10", "Led 11", "Led 12", "Led 13", "Led 14", "Led 15", "Led 16",
		"Led 17", "Led 18", "Led 19", "Led 20", "Led 21", "Led 22", "Led 23", "Led 24", "Led 25", "Led 26", "Led 27", "Led 28", "Led 29"
	],
	displayName: "Elite Capellix Cooler",
	ledCount: 29,
	width: 7,
	height: 7,
	image: "https://assets.signalrgb.com/devices/brands/corsair/aio/capellix.png"
};

const EliteRGBCooler = {
	positioning: [
				 [ 1, 0], [ 2, 0], [ 3, 0],
		[ 0, 1],		  [ 2, 1],        [ 4, 1],
		[ 0, 2], [ 1, 2],        [ 3, 2], [ 4, 2],
		[ 0, 3],		  [ 2, 3],        [ 4, 3],
				 [ 1, 4], [ 2, 4], [ 3, 4]
	],
	mapping: [
	         15, 14, 13,
	       4,	  0,	12,
	       5, 	1,  3,	11,
	       6,	  2,	10,
	           7, 8, 9
	],
	LedNames: [
		"Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10", "Led 11", "Led 12", "Led 13", "Led 14", "Led 15", "Led 16"
	],
	displayName: "Elite RGB Cooler",
	ledCount: 16,
	width: 5,
	height: 5,
	image: "https://assets.signalrgb.com/devices/brands/corsair/aio/rgb-elite.png"
};

const DeviceDict = {
	"None": null,
	"Elite Capellix": EliteCapellixCooler,
	"Elite LCD": EliteLCDCooler,
	"Elite RGB": EliteRGBCooler
};
