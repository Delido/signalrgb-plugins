// Modifying SMBUS Plugins is -DANGEROUS- and can -DESTROY- devices.
export function Name() { return "Asus Ampere/Lovelace GPU"; }
export function Publisher() { return "WhirlwindFX"; }
export function Documentation(){ return "troubleshooting/asus"; }
export function Type() { return "SMBUS"; }
export function Size() { return [30, 1]; }
export function DefaultPosition(){return [200, 125];}
export function DefaultScale(){return 2.5;}
export function LedNames() { return vLedNames; }
export function LedPositions() { return vLedPositions; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
MountingOrientation:readonly
*/
export function ControllableParameters() {
	return [
		{"property":"shutdownColor", "group":"lighting", "label":"Shutdown Color", "min":"0", "max":"360", "type":"color", "default":"#009bde"},
		{"property":"LightingMode", "group":"lighting", "label":"Lighting Mode", "type":"combobox", "values":["Canvas", "Forced"], "default":"Canvas"},
		{"property":"forcedColor", "group":"lighting", "label":"Forced Color", "min":"0", "max":"360", "type":"color", "default":"#009bde"},
		{"property":"MountingOrientation", "group":"lighting", "label":"Mounting Orientation", "type":"combobox", "values":["Horizontal", "Vertical"], "default":"Horizontal"},
	];
}

let vLedNames = [];
let vLedPositions = [];
let lastMountingOrientation = null;

/** @param {FreeAddressBus} bus */
export function Scan(bus) {
	const FoundAddresses = [];

	  // Skip any non AMD / INTEL Busses
	  if (!bus.IsNvidiaBus()) {
		return [];
	}

	for(const AsusGPUID of Asus3000GPUIDs) {
		if(AsusGPUID.Vendor === bus.Vendor() &&
		AsusGPUID.SubVendor === bus.SubVendor() &&
		AsusGPUID.Device === bus.Product() &&
		AsusGPUID.SubDevice === bus.SubDevice()
		) {
			// No Quick Write test on Nvidia
			//if(bus.ReadByteWithoutRegister(AsusGPUID.Address) > 0) {
			FoundAddresses.push(AsusGPUID.Address);
			//}
		}
	}

	return FoundAddresses;
}

const OldRGBData = [];

export function Initialize() {
	AsusGPU.getDeviceInformation();
	SetGPUNameFromBusIds();

	AsusGPU.setDirectMode(0x01);

	// ENEInterface.WriteRegister(0x80A2, 0x16);
	// ENEInterface.WriteRegister(0x80D0, 0x0F);
	// ENEInterface.WriteRegister(0x80D1, 0x4F);
	// ENEInterface.WriteRegister(0x80D0, 0x0F);
	// ENEInterface.WriteRegister(0x80D1, 0x4F);
	// ENEInterface.WriteBlock(0x8020, [0x01, 0x01]);
	// ENEInterface.WriteRegister(0x8024, 0);
	// ENEInterface.WriteRegister(0x802F, 1);

	//AsusGPU.auraWriteRegister(0x8024, 0x00); //This is an unknown register. it comes right after direction.
	//AsusGPU.auraWriteRegister(0x802f, 0x01);
}

export function Render() {
	if(MountingOrientation !== lastMountingOrientation) {
		lastMountingOrientation = MountingOrientation;
		AsusGPU.getDeviceInformation();
		OldRGBData.length = 0;
		return;
	}
	sendColors();
}

export function Shutdown() {
	AsusGPU.setDirectMode(0x00);
	AsusGPU.setMode(AsusGPU.modes.rainbow);
}

function SetGPUNameFromBusIds() {
	for(const AsusGPUID of Asus3000GPUIDs) {
		if(AsusGPUID.Vendor === bus.Vendor() &&
		AsusGPUID.SubVendor === bus.SubVendor() &&
		AsusGPUID.Device === bus.Product() &&
		AsusGPUID.SubDevice === bus.SubDevice()
		) {
			device.setName(AsusGPUID.Name);
		}
	}
}

let refreshColors = false;

function sendColors(shutdown = false) {

	const RGBData = [];

	for(let iIdx = 0; iIdx < vLedPositions.length; iIdx++) {
		const iPxX = vLedPositions[iIdx][0];
		const iPxY = vLedPositions[iIdx][1];
		let color;

		if(shutdown) {
			color = hexToRgb(shutdownColor);
		} else if (LightingMode === "Forced") {
			color = hexToRgb(forcedColor);
		} else {
			color = device.color(iPxX, iPxY);
		}

		const iLedIdx = iIdx * 3;
		RGBData[iLedIdx] = color[0];
		RGBData[iLedIdx+1] = color[2];
		RGBData[iLedIdx+2] = color[1];

		if(OldRGBData[iLedIdx] !== RGBData[iLedIdx] || OldRGBData[iLedIdx+1] !== RGBData[iLedIdx+1] || OldRGBData[iLedIdx+2] !== RGBData[iLedIdx+2]) {
			refreshColors = true;
			OldRGBData[iLedIdx] = RGBData[iLedIdx];
			OldRGBData[iLedIdx+1] = RGBData[iLedIdx+1];
			OldRGBData[iLedIdx+2] = RGBData[iLedIdx+2];
		}
	}

	if(refreshColors) {
		bus.WriteBlock(0x00, 2, [0x81, 0x00]);

		let offset = 0;
		while(offset < RGBData.length) {
			const packetSize = Math.min(RGBData.length - offset, 31);
			const packet = [packetSize, ...RGBData.slice(offset, offset + packetSize)];
			bus.WriteBlock(AsusGPU.registers.color, packetSize + 1, packet);
			offset += packetSize;
		}

		refreshColors = false;
	}

}

class AsusGPUController {
	constructor() {
		this.registers =
        {
        	command   : 0x00,
        	direction : 0x01,
        	speed     : 0x02,
        	color     : 0x03
        };

		this.commands =
        {
        	action    : 0x80,
        	speed     : 0x20,
        	direction : 0x24,
        	apply     : 0x2F
        };

		this.modes =
        {
        	static       : 0x01,
        	breathing    : 0x02,
        	rainbow      : 0x05,
        	comet        : 0x07,
        	yoyo         : 0x0C,
        	starryNight  : 0x0D,
        	flashAndDash : 0x0A,
        };

		this.speeds =
        {
        	slow   : 0x05,
        	medium : 0x00,
        	fast   : 0xFB
        };

		this.auraCommands =
        {
        	deviceName   : 0x1000,
        	configTable  : 0x1C00,
        	directAccess : 0x8020,
        	colorCtlV1   : 0x8000,
        	colorCtlV2   : 0x8100,
        	effectCtlV2  : 0x8160, //This is like an extension of color ctlV2?
        	apply        : 0x80A0,
        	ColorApply   : 0x802F,
        };
	}

	auraReadRegister(reg) {
		bus.WriteBlock(0x00, 2, [reg >> 8 & 0xFF, reg & 0xff]);

		return bus.ReadByte(0x81);
	}

	auraWriteRegister(reg, value) {
		bus.WriteBlock(0x00, 2, [reg >> 8 & 0xFF, reg & 0xff]);

		bus.WriteByte(0x01, value);
	}

	auraWriteRegisterBlock(reg, size, data) {
		bus.WriteBlock(this.registers.command, 2, [reg >> 8 & 0xFF, reg & 0xff]);
		bus.WriteBlock(0x03, size, data);
	}

	getDeviceInformation() {
		const deviceName = AsusGPU.getDeviceName();
		const deviceConfigTable = AsusGPU.getDeviceConfigTable();
		let deviceLEDCount = deviceConfigTable[3]; //No need to properly parse this. We only pull a single value off it for now.
		device.log("Device Controller Identifier: " + deviceName, {toFile: true});
		device.log("Device LED Count: " + deviceLEDCount, {toFile: true});
		vLedNames = [];
		vLedPositions = [];

		if(deviceLEDCount > 30 || deviceLEDCount < 0) {
			device.log("Device returned out of bounds LED Count.", {toFile: true});
			deviceLEDCount = 30;
		}

		const customLayout = getCustomDeviceLayout(deviceLEDCount);

		if(customLayout) {
			for(let i = 0; i < deviceLEDCount; i++) {
				vLedNames.push(`LED ${i + 1}`);
				vLedPositions.push(customLayout.positions[i]);
			}
			device.setControllableLeds(vLedNames, vLedPositions);
			device.setSize(customLayout.size);
		} else {
			for(let i = 0; i < deviceLEDCount; i++) {
				vLedNames.push(`LED ${i + 1}`);
				vLedPositions.push([ i, 0 ]);
			}
			device.setControllableLeds(vLedNames, vLedPositions);
			device.setSize([deviceLEDCount, 1]);
		}
	}

	getDeviceName() {
		const deviceName = [];

		for(let iIdx = 0; iIdx < 16; iIdx++) {
			const character = this.auraReadRegister(this.auraCommands.deviceName + iIdx);

			if(character > 0) {
				deviceName.push(character);
			}
		}

		return String.fromCharCode(...deviceName);
	}

	getDeviceConfigTable() {
		const configTable = new Array(65);

		for(let iIdx = 0; iIdx < 64; iIdx++) {
			configTable[iIdx] = this.auraReadRegister(this.auraCommands.configTable + iIdx);
		}

		return configTable;
	}

	setDirectMode(directMode) {
		this.auraWriteRegister(this.auraCommands.directAccess, directMode);
		this.auraWriteRegister(0x80A0, 1);
	}

	setMode(deviceMode) {
		bus.WriteBlock(this.registers.command, 2, [this.commands.action, this.commands.speed]);
		bus.WriteBlock(this.registers.speed, 2, [this.speeds.medium, deviceMode]);
		this.setDirection(0x00); //0x00 is left. 0x01 is right. I'm not making a dict for two values.
	}

	setDirection(direction) {
		bus.WriteBlock(this.registers.command, 2, [this.commands.action, this.commands.direction]);
		bus.WriteByte(this.registers.direction, direction);
		bus.WriteBlock(this.registers.command, 2, [this.commands.action, this.commands.apply]);
		bus.WriteByte(this.registers.direction, 0x01); //apply direction
	}
}
export class BinaryUtils{
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

class ENEInterface{

	static WriteBlock(register, data){

		bus.WriteBlock(0x00, 2, BinaryUtils.WriteInt16BigEndian(register));

		//bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));
		bus.WriteBlock(0x03, data.length, data);
	}

	static WriteWord(register){
		bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));
		bus.WriteByte(0x01, 0x00);
		bus.WriteByte(0x01, 0x01);
	}

	static WriteRegisterWithoutArgument(register) {
		bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));
	}

	static WriteRegister(register, value){
		bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));
		bus.WriteByte(0x01, value);
	}

	static ReadRegister(register){
		bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));

		return bus.ReadByte(0x81);
	}

	static ReadWord(register){
		bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));

		let returnValue = (bus.ReadByte(0x81) << 8) & 0xFF00;
		returnValue |= bus.ReadByte(0x81) & 0xFF;

		return returnValue;
	}

	static ReadBytes(length) {
		for(let bytesToRead = 0; bytesToRead < length; bytesToRead++) {
			bus.ReadByte(0x81);
		}
	}

	static ReadBlockByBytes(register, length){
		bus.WriteWord(0x00, ((register << 8) & 0xFF00) | ((register >> 8) & 0x00FF));

		const returnedBytes = [];

		for(let bytesToRead = 0; bytesToRead < length; bytesToRead++) {
			returnedBytes[bytesToRead] = bus.ReadByte(0x81);
		}

		return returnedBytes;
	}
}

const AsusGPU = new AsusGPUController();

class GPUIdentifier {
	constructor(Vendor, SubVendor, Device, SubDevice, Address, Name, Model = "") {
		this.Vendor = Vendor;
		this.SubVendor = SubVendor;
		this.Device = Device;
		this.SubDevice = SubDevice;
		this.Address = Address;
		this.Name = Name;
		this.Model = Model;
	}
}

class AsusGPUIdentifier extends GPUIdentifier {
	constructor(Device, SubDevice, Name, Model = "") {
		super(0x10DE, 0x1043, Device, SubDevice, 0x67, Name, Model);
	}
}

class NvidiaGPUDeviceIds {
	constructor() {
		this.GTX1050TI       = 0x1C82;
		this.GTX1060         = 0x1C03;
		this.GTX1070         = 0x1B81;
		this.GTX1070TI       = 0x1B82;
		this.GTX1080         = 0x1B80;
		this.GTX1080TI       = 0x1B06;
		this.GTX1650         = 0x1F82;
		this.GTX1650S        = 0x2187;
		this.GTX1660         = 0x2184;
		this.GTX1660TI       = 0x2182;
		this.GTX1660S        = 0x21C4;
		this.RTX2060_TU104   = 0x1E89;
		this.RTX2060_TU106   = 0x1F08;
		this.RTX2060S        = 0x1F47;
		this.RTX2060S_OC     = 0x1F06;
		this.RTX2070         = 0x1F02;
		this.RTX2070_OC      = 0x1F07;
		this.RTX2070S        = 0x1E84;
		this.RTX2080         = 0x1E82;
		this.RTX2080_A       = 0x1E87;
		this.RTX2080S        = 0x1E81;
		this.RTX2080TI_TU102 = 0x1E04;
		this.RTX2080TI       = 0x1E07;
		this.RTX2080_SUPER   = 0x1E81;
		this.RTX3050         = 0x2507;
		this.RTX3060         = 0x2503;
		this.RTX3060_LHR     = 0x2504;
		this.RTX3060_GA104   = 0x2487;
		this.RTX3060TI       = 0x2486;
		this.RTX3060TI_LHR   = 0x2489;
		this.RTX3060TI_GDDR6X = 0x24C9;
		this.RTX3070         = 0x2484;
		this.RTX3070_LHR     = 0x2488;
		this.RTX3070TI       = 0x2482;
		this.RTX3070TI_GA102 = 0x2207;
		this.RTX3080         = 0x2206;
		this.RTX3080_LHR     = 0x2216;
		this.RTX3080_GA102   = 0x220A;
		this.RTX3080TI       = 0x2208;
		this.RTX3090         = 0x2204;
		this.RTX3090TI       = 0x2203;
		this.RTX4060TI		 = 0x2803;
		this.RTX4070		 = 0x2786;
		this.RTX4070TI 		 = 0x2782;
		this.RTX4080 		 = 0x2704;
		this.RTX4090         = 0x2684;
	}
};

const Nvidia = new NvidiaGPUDeviceIds();

class Asus_Ampere_Lovelace_IDs {
	constructor() {
		this.RTX3050_STRIX_GAMING              = 0x8872; //0x2507

		this.RTX3060_STRIX_GAMING              = 0x8818;
		this.RTX3060_STRIX_GAMING_V2		   = 0x8819;
		this.RTX3060_STRIX_GAMING_OC           = 0x87F3;
		this.RTX3060_STRIX_GAMING_OC_2         = 0x87F4;
		this.RTX3060_TUF_GAMING_OC             = 0x87F5;
		this.RTX3060_TUF_GAMING_OC_V2          = 0x8816;
		this.RTX3060_TUF_GAMING_OC_V2_2		   = 0x8865;
		this.RTX3060_TUF_GAMING_O12G           = 0x87F6; //0x2503
		this.RTX3060_TUF_GAMING_OC_V2_LHR      = 0x8817; //0x2504
		this.RTX3060_STRIX_O12G_KO             = 0x8821; //0x2504
		this.RTX3060_STRIX_O12G_KO_2           = 0x87FB;
		this.RTX3060_TUF_O12G_OC_DEMON_SLAYER  = 0x8896;

		this.RTX3060TI_STRIX_GAMING            = 0x87BA;
		this.RTX3060TI_STRIX_GAMING_KO         = 0x883E;
		this.RTX3060TI_STRIX_GAMING_KO_2       = 0x87CA; //0x2486
		this.RTX3060TI_STRIX_GAMING_V2         = 0x8834;
		this.RTX3060TI_TUF_GAMING_OC           = 0x87C6;
		this.RTX3060TI_TUF_GAMING_OC_LHR       = 0x8827;
		this.RTX3060TI_TUF_O8G_GDDR6X 		   = 0x88AC;

		this.RTX3070_STRIX_GAMING              = 0x87BE;
		this.RTX3070_STRIX_GAMING_OC           = 0x87D8;
		this.RTX3070_STRIX_GAMING_OC_3         = 0x87D0; //Untested.
		this.RTX3070_STRIX_GAMING_OC_2         = 0x87B8;
		this.RTX3070_STRIX_GAMING_OC_WHITE     = 0x87E0;
		this.RTX3070_STRIX_GAMING_OC_WHITE_V2  = 0x8833; //LHR
		this.RTX3070_STRIX_GAMING_OC_LHR       = 0x882C;
		this.RTX3070_STRIX_GAMING_V2_LHR       = 0x882D;
		this.RTX3070_STRIX_GAMING_WHITE_LHR    = 0x8832;
		this.RTX3070_STRIX_GAMING_LHR          = 0x883A;
		this.RTX3070_STRIX_KO_V2               = 0x8842; //LHR
		this.RTX3070_TUF_GAMING                = 0x87B9;
		this.RTX3070_TUF_GAMING_2			   = 0x87C2;
		this.RTX3070_TUF_GAMING_OC             = 0x87E1;
		this.RTX3070_TUF_GAMING_OC_2           = 0x87C1;
		this.RTX3070_TUF_GAMING_OC_LHR         = 0x8825;

		this.RTX3070TI_STRIX_GAMING            = 0x880E;
		this.RTX3070TI_STRIX_GAMING_2          = 0x880F;
		this.RTX3070TI_TUF_GAMING              = 0x8812;
		this.RTX3070TI_TUF_GAMING_2            = 0x8813;
		this.RTX3070TI_TUF_GAMING_OC 		   = 0x88BC;


		this.RTX3080_STRIX_GAMING_WHITE        = 0x87D1;
		this.RTX3080_STRIX_GAMING_V2 		   = 0x882F;
		this.RTX3080_STRIX_GAMING_WHITE_OC_LHR = 0x8830;
		this.RTX3080_STRIX_GAMING_GUNDAM       = 0x87CE;
		this.RTX3080_STRIX_GAMING_OC	       = 0x87AA;
		this.RTX3080_STRIX_GAMING              = 0x87AC;
		this.RTX3080_STRIX_O10G_GAMING_WHITE_V2= 0x8831; //2216
		this.RTX3080_TUF_GAMING_V2_LHR         = 0x8822;
		this.RTX3080_TUF_GAMING_LHR            = 0x8823;
		this.RTX3080_TUF_GAMING                = 0x87B2;
		this.RTX3080_TUF_GAMING_V2             = 0x87C4;
		this.RTX3080_TUF_O10G_GAMING           = 0x882B;
		this.RTX3080_TUF_GAMING_OC_LHR         = 0x882E;
		this.RTX3080_TUF_GAMING_OC             = 0x87B0;
		this.RTX3080_TUF_GAMING_OC_8GB         = 0x886A;
		this.RTX3080_STRIX_GAMING_LHR 		   = 0x886C;
		this.RTX3080_TUF_GAMING_OC_GDDR6X      = 0x886E; //0x220A
		this.RTX3080_TUF_GAMING_OC_GDDR6X_LHR  = 0x886F; //0x220A
		this.RTX3080_STRIX_O12G_GAMING_OC      = 0x886B;
		this.RTX3080_STRIX_EVA                 = 0x8887;

		this.RTX3080TI_TUF_GAMING_OC               = 0x8802;
		this.RTX3080TI_TUF_GAMING                  = 0x8803;
		this.RTX3080TI_STRIX_GAMING                = 0x8807;
		this.RTX3080TI_STRIX_GAMING_OC             = 0x8808;
		this.RTX3080TI_STRIX_LC_GAMING_OC          = 0x8809;
		this.RTX3080TI_STRIX_LC                    = 0x880a;

		this.RTX3090_TUF_GAMING_OC                 = 0x87B3;
		this.RTX3090_TUF_GAMING                    = 0x87B5;
		this.RTX3090_STRIX_GAMING                  = 0x87AF;
		this.RTX3090_STRIX_GAMING_2				   = 0x87AD;
		this.RTX3090_STRIX_GAMING_WHITE            = 0x87D9;
		this.RTX3090_STRIX_GAMING_WHITE_V2         = 0x87DA;
		this.RTX3090_STRIX_GAMING_EVA			   = 0x8886;

		this.RTX3090TI_STRIX_LC_GAMING_OC          = 0x8870;
		this.RTX3090TI_TUF_GAMING				   = 0x8874;

		this.RTX4060TI_TUF_GAMING_OC			   = 0x88F6;

		this.RTX4070_TUF_GAMING					   = 0x88DF;
		this.RTX4070_TUF_GAMING_2				   = 0x88DE;
		this.RTX4070_TUF_GAMING_OC				   = 0x88EC;
		this.RTX4070TI_TUF_GAMING_OC			   = 0x88A3;
		this.RTX4070TI_12GB_STRIX_GAMING_OC		   = 0X88A7;
		this.RTX4070TI_12GB_STRIX_GAMING_OC_2      = 0x88DC;
		this.RTX4070TI_12GB_STRIX_GAMING_OC_3	   = 0X88E5;
		this.RTX4070TI_TUF_GAMING				   = 0x88A6;
		this.RTX4070TI_TUF_GAMING_2                = 0x88DD;

		this.RTX4070TI_TUF_GAMING_OC_2			   = 0x88A4;

		this.RTX4080_STRIX_GAMING_3				   = 0x88A0;
		this.RTX4080_TUF_GAMING					   = 0x88A1;
		this.RTX4080_STRIX_GAMING				   = 0x889f;
		this.RTX4080_TUF_GAMING_2				   = 0x88A2;
		this.RTX4080_TUF_GAMING_3                  = 0x88CB;
		this.RTX4080_STRIX_GAMING_OC 			   = 0x88BF;
		this.RTX4080_STRIX_GAMING_2				   = 0x88C0;
		this.RTX4080_STRIX_GAMING_OC_WHITE		   = 0x88C8;
		this.RTX4080_STRIX_GAMING_WHITE			   = 0x88C9;
		this.RTX4080_TUF_GAMING_OC				   = 0x88CA;

		this.RTX4090_STRIX_GAMING                  = 0x889C;
		this.RTX4090_STRIX_GAMING_2                = 0x889D;
		this.RTX4090_STRIX_GAMING_WHITE_OC		   = 0x88C3;
		this.RTX4090_STRIX_GAMING_WHITE			   = 0x88C4;
		this.RTX4090_TUF_GAMING                    = 0x889A;
		this.RTX4090_TUF_GAMING_2                  = 0x889B;
		this.RTX4090_TUF_GAMING_OC				   = 0x88E6;
		this.RTX4090_TUF_GAMING_OC_2               = 0x88E2;
	}
}

const AsusID = new Asus_Ampere_Lovelace_IDs();

export function BrandGPUList(){ return Asus3000GPUIDs; }

const Asus3000GPUIDs =
[
	new AsusGPUIdentifier(Nvidia.RTX3050, AsusID.RTX3050_STRIX_GAMING, "Asus ROG Strix RTX 3050 Gaming"),

	new AsusGPUIdentifier(Nvidia.RTX3060_LHR, AsusID.RTX3060_STRIX_GAMING, "Asus ROG Strix RTX 3060 O12G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3060_LHR, AsusID.RTX3060_STRIX_GAMING_V2, "Asus ROG Strix RTX 3060 O12G Gaming V2 LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3060, AsusID.RTX3060_STRIX_GAMING_OC, "Asus ROG Strix RTX 3060 O12G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060, AsusID.RTX3060_STRIX_GAMING_OC_2, "Asus ROG Strix RTX 3060 O12G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060, AsusID.RTX3060_STRIX_O12G_KO_2, "Asus ROG Strix RTX 3060 KO OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060_LHR, AsusID.RTX3060_STRIX_O12G_KO, "Asus ROG Strix RTX 3060 KO OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060, AsusID.RTX3060_TUF_GAMING_O12G, "Asus TUF RTX 3060 Gaming O12G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060, AsusID.RTX3060_TUF_GAMING_OC, "Asus TUF RTX 3060 Gaming O12G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060_LHR, AsusID.RTX3060_TUF_GAMING_OC_V2, "Asus TUF RTX 3060 Gaming O12G Gaming OC V2"),
	new AsusGPUIdentifier(Nvidia.RTX3060_GA104, AsusID.RTX3060_TUF_GAMING_OC_V2_2, "Asus 3060 TUF Gaming O12G Gaming OC V2 GA104"),
	new AsusGPUIdentifier(Nvidia.RTX3060_LHR, AsusID.RTX3060_TUF_GAMING_OC_V2_LHR, "Asus TUF 3060 Gaming O12G Gaming OC V2 LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3060_LHR, AsusID.RTX3060_TUF_O12G_OC_DEMON_SLAYER, "Asus TUF 3060 Gaming OC Demon Slayer"),

	new AsusGPUIdentifier(Nvidia.RTX3060TI_LHR, AsusID.RTX3060TI_STRIX_GAMING_V2, "Asus ROG Strix 3060TI O8G Gaming V2"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI_LHR, AsusID.RTX3060TI_TUF_GAMING_OC_LHR, "Asus TUF 3060TI O8G Gaming OC LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI, AsusID.RTX3060TI_STRIX_GAMING, "Asus ROG Strix 3060TI O8G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI, AsusID.RTX3060TI_STRIX_GAMING_KO_2, "Asus ROG Strix 3060TI O8G Gaming KO"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI_LHR, AsusID.RTX3060TI_STRIX_GAMING_KO, "Asus ROG Strix 3060TI O8G Gaming KO LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI_LHR, AsusID.RTX3060TI_STRIX_GAMING_KO_2, "Asus ROG Strix 3060TI O8G Gaming KO LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI, AsusID.RTX3060TI_TUF_GAMING_OC, "Asus TUF 3060TI O8G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3060TI_GDDR6X, AsusID.RTX3060TI_TUF_O8G_GDDR6X, "Asus TUF 3060TI O8G GDDR6X"),

	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_STRIX_GAMING, "Asus ROG Strix 3070 O8G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_STRIX_GAMING_OC, "Asus ROG Strix 3070 O8G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_STRIX_GAMING_OC_2, "Asus ROG Strix 3070 O8G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_STRIX_GAMING_OC_3, "Asus ROG Strix 3070 O8G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_STRIX_GAMING_OC_WHITE, "Asus ROG Strix 3070 Gaming OC White"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_STRIX_GAMING_OC_WHITE_V2, "Asus ROG Strix 3070 Gaming OC White V2"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_STRIX_GAMING_OC_LHR, "Asus ROG Strix 3070 Gaming OC LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_TUF_GAMING, "Asus TUF 3070 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_TUF_GAMING_2, "Asus TUF 3070 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_TUF_GAMING_OC, "Asus TUF 3070 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_STRIX_KO_V2, "Asus 3070 KO V2 OC"),
	new AsusGPUIdentifier(Nvidia.RTX3070, AsusID.RTX3070_TUF_GAMING_OC_2, "Asus TUF 3070 Gaming OC 2"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_TUF_GAMING_OC_LHR, "Asus TUF 3070 Gaming OC LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_STRIX_GAMING_V2_LHR, "Asus ROG Strix 3070 O8G V2 LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_STRIX_GAMING_WHITE_LHR, "Asus ROG Strix 3070 O8G White LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3070_LHR, AsusID.RTX3070_STRIX_GAMING_LHR, "Asus ROG Strix 3070 O8G Gaming LHR"),

	new AsusGPUIdentifier(Nvidia.RTX3070TI, AsusID.RTX3070TI_STRIX_GAMING, "Asus ROG Strix 3070TI O8G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3070TI, AsusID.RTX3070TI_STRIX_GAMING_2, "Asus ROG Strix 3070TI O8G Gaming"),

	new AsusGPUIdentifier(Nvidia.RTX3070TI, AsusID.RTX3070TI_TUF_GAMING, "Asus TUF 3070TI Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3070TI, AsusID.RTX3070TI_TUF_GAMING_2, "Asus TUF 3070TI Gaming 2"),
	new AsusGPUIdentifier(Nvidia.RTX3070TI_GA102, AsusID.RTX3070TI_TUF_GAMING_OC, "Asus TUF 3070TI Gaming OC"),


	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_STRIX_GAMING_WHITE, "Asus ROG Strix 3080 O10G White Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_STRIX_GAMING_V2, "Asus ROG Strix 3080 O10G Gaming LHR"),

	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_STRIX_GAMING_WHITE_OC_LHR, "Asus ROG Strix 3080 O10G White OC LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_STRIX_GAMING_GUNDAM, "Asus ROG Strix 3080 O10G Gundam"),
	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_STRIX_GAMING, "Asus ROG Strix 3080 O10G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_STRIX_GAMING_OC, "Asus ROG Strix 3080 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_TUF_GAMING_V2_LHR, "Asus TUF 3080 O10G V2 LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_TUF_GAMING_LHR, "Asus TUF 3080 O10G Gaming LHR"),

	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_TUF_GAMING, "Asus TUF 3080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_TUF_GAMING_OC_8GB, "Asus TUF 3080 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080_GA102, AsusID.RTX3080_STRIX_GAMING_LHR, "Asus Strix 3080 Gaming LHR"),


	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_TUF_GAMING_V2, "Asus TUF 3080 Gaming V2"),
	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_TUF_O10G_GAMING, "Asus TUF 3080 O10G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3080_GA102, AsusID.RTX3080_TUF_GAMING_OC_GDDR6X, "Asus TUF 3080 Gaming OC GDDR6X"),
	new AsusGPUIdentifier(Nvidia.RTX3080_GA102, AsusID.RTX3080_TUF_GAMING_OC_GDDR6X_LHR, "Asus TUF 3080 Gaming OC GDDR6X LHR"),
	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_TUF_GAMING_OC_LHR, "Asus ROG Strix 3080 O10G Gaming OC LHR"),

	new AsusGPUIdentifier(Nvidia.RTX3080, AsusID.RTX3080_TUF_GAMING_OC, "Asus TUF 3080 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080_GA102, AsusID.RTX3080_STRIX_O12G_GAMING_OC, "Asus ROG Strix 3080 O12G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080_LHR, AsusID.RTX3080_STRIX_O10G_GAMING_WHITE_V2, "Asus ROG Strix 3080 O10G Gaming White V2"),
	new AsusGPUIdentifier(Nvidia.RTX3080_GA102, AsusID.RTX3080_STRIX_EVA, "Asus ROG Strix 3080 O12G EVA"),

	new AsusGPUIdentifier(Nvidia.RTX3080TI, AsusID.RTX3080TI_TUF_GAMING_OC, "Asus TUF 3080TI Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080TI, AsusID.RTX3080TI_TUF_GAMING, "Asus TUF 3080TI Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3080TI, AsusID.RTX3080TI_STRIX_GAMING, "Asus ROG Strix 3080TI O12G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3080TI, AsusID.RTX3080TI_STRIX_GAMING_OC, "Asus ROG Strix 3080TI O12G Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080TI, AsusID.RTX3080TI_STRIX_LC_GAMING_OC, "Asus ROG Strix 3080TI LC Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3080TI, AsusID.RTX3080TI_STRIX_LC, "Asus ROG Strix RTX 3080TI LC"),

	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_TUF_GAMING_OC, "Asus TUF 3090 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_TUF_GAMING, "Asus TUF 3090 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_STRIX_GAMING, "Asus ROG Strix 3090 O24G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_STRIX_GAMING_2, "Asus ROG Strix 3090 O24G Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_STRIX_GAMING_WHITE, "Asus ROG Strix 3090 O24G Gaming White"),
	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_STRIX_GAMING_WHITE_V2, "Asus ROG Strix 3090 O24G Gaming White V2"),
	new AsusGPUIdentifier(Nvidia.RTX3090, AsusID.RTX3090_STRIX_GAMING_EVA, "Asus ROG Strix 3090 EVA Edition"),

	new AsusGPUIdentifier(Nvidia.RTX3090TI, AsusID.RTX3090TI_STRIX_LC_GAMING_OC, "Asus ROG Strix 3090TI LC OC"),
	new AsusGPUIdentifier(Nvidia.RTX3090TI, AsusID.RTX3090TI_TUF_GAMING, "Asus TUF 3090TI Gaming"),

	new AsusGPUIdentifier(Nvidia.RTX4060TI, AsusID.RTX4060TI_TUF_GAMING_OC, "Asus 4060Ti TUF Gaming OC"),

	new AsusGPUIdentifier(Nvidia.RTX4070, AsusID.RTX4070_TUF_GAMING, "Asus 4070 TUF Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4070, AsusID.RTX4070_TUF_GAMING_2, "Asus 4070 TUF Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4070, AsusID.RTX4070_TUF_GAMING_OC, "Asus 4070 TUF Gaming OC"),

	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_12GB_STRIX_GAMING_OC, "Asus ROG Strix RTX 4070Ti 12GB Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_12GB_STRIX_GAMING_OC_2, "Asus ROG Strix RTX 4070Ti 12GB Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_12GB_STRIX_GAMING_OC_3, "Asus ROG Strix RTX 4070Ti 12GB Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_TUF_GAMING_OC, "Asus TUF RTX 4070Ti Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_TUF_GAMING_OC_2, "Asus TUF RTX 4070Ti Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_TUF_GAMING, "Asus TUF RTX 4070Ti 12GB Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4070TI, AsusID.RTX4070TI_TUF_GAMING_2, "Asus TUF RTX 4070Ti 12GB Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_TUF_GAMING, "Asus TUF RTX 4080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_TUF_GAMING_2, "Asus TUF RTX 4080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_TUF_GAMING_3, "Asus TUF RTX 4080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_STRIX_GAMING, "Asus ROG Strix RTX 4080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_STRIX_GAMING_2, "Asus ROG Strix RTX 4080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_STRIX_GAMING_3, "Asus ROG Strix RTX 4080 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_STRIX_GAMING_OC, "Asus ROG Strix 4080 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_STRIX_GAMING_WHITE, "Asus ROG Strix 4080 Gaming White"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_STRIX_GAMING_OC_WHITE, "Asus ROG Strix 4080 Gaming OC White"),
	new AsusGPUIdentifier(Nvidia.RTX4080, AsusID.RTX4080_TUF_GAMING_OC, "Asus TUF RTX 4080 Gaming OC"),

	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_STRIX_GAMING, "Asus ROG Strix 4090 Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_STRIX_GAMING_2, "Asus ROG Strix 4090 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_STRIX_GAMING_WHITE, "Asus ROG Strix 4090 Gaming White"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_STRIX_GAMING_WHITE_OC, "Asus ROG Strix 4090 Gaming White OC"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_TUF_GAMING, "Asus TUF RTX 4090 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_TUF_GAMING_2, "Asus TUF RTX 4090 Gaming"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_TUF_GAMING_OC, "Asus 4090 TUF Gaming OC"),
	new AsusGPUIdentifier(Nvidia.RTX4090, AsusID.RTX4090_TUF_GAMING_OC_2, "Asus 4090 TUF Gaming OC"),
];

function getCustomDeviceLayout(ledCount) {
	const strix4070TiSubDevices = [
		AsusID.RTX4070TI_12GB_STRIX_GAMING_OC,
		AsusID.RTX4070TI_12GB_STRIX_GAMING_OC_2,
		AsusID.RTX4070TI_12GB_STRIX_GAMING_OC_3
	];

	if(ledCount === 29 && strix4070TiSubDevices.includes(bus.SubDevice())) {
		// ROG Strix 4070 Ti - Rechteckschleife rechte kurze Kante
		// LED 1-7:   ROG Text (Laengskante, vordere Flaeche)
		// LED 8:     vordere Kante unten, LED 9: vordere Kante oben
		// LED 10-19: obere Flaeche (Tiefe), LED 20: hintere Kante oben, LED 21: unten
		// LED 22-29: untere Flaeche (Tiefe)

		if(MountingOrientation === "Vertical") {
			// Vertikaler Einbau: X/Y tauschen (I/O Bracket oben, Power Connector unten)
			//
			//  X:  0     1     2     3
			//  Y=0:               [1]   <- ROG Text oben (I/O Bracket Ende)
			//  Y=1:               [2]
			//  Y=2:               [3]
			//  Y=3:               [4]
			//  Y=4:               [5]
			//  Y=5:               [6]
			//  Y=6:               [7]   <- ROG Text unten
			//  Y=11:[10-19][9][8][22-29] <- kurze Kante unten (Power Connector Ende)
			return {
				size: [4, 12],
				positions: [
					[3, 0],   // LED 1:  ROG text, oben
					[3, 1],   // LED 2
					[3, 2],   // LED 3
					[3, 3],   // LED 4
					[3, 4],   // LED 5
					[3, 5],   // LED 6
					[3, 6],   // LED 7:  ROG text, unten
					[2, 11],  // LED 8:  vordere Kante unten
					[1, 11],  // LED 9:  vordere Kante oben
					[0, 11],  // LED 10: obere Flaeche (Tiefe) - alle gleich
					[0, 11],  // LED 11
					[0, 11],  // LED 12
					[0, 11],  // LED 13
					[0, 11],  // LED 14
					[0, 11],  // LED 15
					[0, 11],  // LED 16
					[0, 11],  // LED 17
					[0, 11],  // LED 18
					[0, 11],  // LED 19
					[1, 11],  // LED 20: hintere Kante oben
					[2, 11],  // LED 21: hintere Kante unten
					[3, 11],  // LED 22: untere Flaeche - alle gleich
					[3, 11],  // LED 23
					[3, 11],  // LED 24
					[3, 11],  // LED 25
					[3, 11],  // LED 26
					[3, 11],  // LED 27
					[3, 11],  // LED 28
					[3, 11],  // LED 29
				]
			};
		}

		// Horizontaler Einbau (Standard)
		//  X:  0  1  2  3  4  5  6  7  8  9 10 11
		//  Y=0:                              [10-19]  <- obere Flaeche (Tiefe)
		//  Y=1:                           [9]   [20]  <- vorne/hinten oben
		//  Y=2:                           [8]   [21]  <- vorne/hinten unten
		//  Y=3:[1][2][3][4][5][6][7]      [22-29]    <- ROG Text + untere Flaeche
		return {
			size: [12, 4],
			positions: [
				[0,  3],  // LED 1:  ROG text, links
				[1,  3],  // LED 2
				[2,  3],  // LED 3
				[3,  3],  // LED 4
				[4,  3],  // LED 5
				[5,  3],  // LED 6
				[6,  3],  // LED 7:  ROG text, rechts
				[11, 2],  // LED 8:  vordere Kante unten
				[11, 1],  // LED 9:  vordere Kante oben
				[11, 0],  // LED 10: obere Flaeche (Tiefe) - alle gleich
				[11, 0],  // LED 11
				[11, 0],  // LED 12
				[11, 0],  // LED 13
				[11, 0],  // LED 14
				[11, 0],  // LED 15
				[11, 0],  // LED 16
				[11, 0],  // LED 17
				[11, 0],  // LED 18
				[11, 0],  // LED 19
				[11, 1],  // LED 20: hintere Kante oben
				[11, 2],  // LED 21: hintere Kante unten
				[11, 3],  // LED 22: untere Flaeche (Tiefe) - alle gleich
				[11, 3],  // LED 23
				[11, 3],  // LED 24
				[11, 3],  // LED 25
				[11, 3],  // LED 26
				[11, 3],  // LED 27
				[11, 3],  // LED 28
				[11, 3],  // LED 29
			]
		};
	}

	return null;
}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	const colors = [];
	colors[0] = parseInt(result[1], 16);
	colors[1] = parseInt(result[2], 16);
	colors[2] = parseInt(result[3], 16);

	return colors;
}

export function ImageUrl() {
	return "https://marketplace.signalrgb.com/devices/default/gpu.png";
}