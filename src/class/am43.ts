import EventEmitter from "events";

import debug from "debug";
import { Characteristic, Peripheral, Service } from "@abandonware/noble";
import IAM43Status from "../interface/IAM43Status";
import { BlindStates } from "./BlindStates";
import { IAM43Actions } from "./IAM43Actions";

const serviceUUID = "0000fe5000001000800000805f9b34fb";
const am43CharUUID = "0000fe5100001000800000805f9b34fb";

const NOBLE_SERVICE_UID = "fe50";
const NOBLE_BAT_CHAR_UID = "fe51";

const AM43HANDLE = 0x000e;

const HEX_KEY_OPEN_BLINDS = "00ff00009a0d010096";
const HEX_KEY_CLOSE_BLINDS = "00ff00009a0d0164f2";
const HEX_KEY_STOP_BLINDS = "00ff00009a0a01cc5d";

const HEX_KEY_POSITION_BLINDS_PREFIX = "00ff0000";
const HEY_KEY_POSITION_BLIND_FIXED_CRC_CONTENT = "9a0d01";

const HEX_KEY_BATTERY_REQUEST = "00ff00009aa2010138";
const HEY_KEY_LIGHT_REQUEST = "00ff00009aaa010130";
const HEY_KEY_POSITION_REQUEST = "00ff00009aa701013d";

const batteryNotificationIdentifier = "a2";
const positionNotificationIdentifier = "a7";
const lightNotificationIdentifier = "aa";

const fullMovingTime = 137000;

export default class am43 extends EventEmitter {
    private static busyDevice: am43 | null = null;
    
    private currentRetry: number;
    private maxRetries: number;
    private success: boolean;
    private batterysuccess: boolean;
    private lightsuccess: boolean;
    private positionsuccess: boolean;
    public log: debug.Debugger;
    private state: BlindStates;
    private lastaction: IAM43Actions;
    public successtime: Date | null;
    private connecttime: Date | null;
    private batterypercentage: number | null;
    private lightpercentage: number | null;
    private positionpercentage: number | null;
    
    constructor(public id: string | undefined, private peripheral: Peripheral) {
        super();
        this.log = debug(`am43:${id}`);
        this.id = id;
        this.peripheral = peripheral;
        this.connecttime = null;
        this.successtime = null;
        this.lastaction = IAM43Actions.NONE;
        this.state = BlindStates.UNKNOWN;
        this.currentRetry = 0;
        this.maxRetries = 30;
        this.success = false;
        this.batterysuccess = false;
        this.lightsuccess = false;
        this.positionsuccess = false;
        this.batterypercentage = null;
        this.lightpercentage = null;
        this.positionpercentage = null;
    }
    
    private writeLog(pLogLine: string | number): void {
        this.log(pLogLine);
    }
    
    private readData(): void {
        if (am43.busyDevice != null) {
            this.writeLog(`Connection busy for other device ${am43.busyDevice.id}, delaying data read...`);
            setTimeout(() => {
                this.readData();
            }, 1000);
            return;
        }
        
        this.performReadData();
    }
    
    private disconnectMeRead() {
        this.writeLog("disconnected for data reading");
        
        if (!this.batterysuccess || !this.positionsuccess || !this.lightsuccess) {
            if (this.currentRetry < this.maxRetries) {
                this.writeLog("Reading data unsuccessful, retrying in 1 second...");
                this.currentRetry = this.currentRetry + 1;
                setTimeout(() => {
                    this.performReadData();
                }, 1000);
            }
            else {
                this.writeLog("Reading data unsuccessful, giving up...");
                am43.busyDevice = null;
                this.currentRetry = 0;
            }
        }
        else {
            this.writeLog("Reading data was successful");
            this.successtime = new Date();
            am43.busyDevice = null;
            this.currentRetry = 0;
            this.emit("stateChanged", () => this.currentState);
        }
    }
    
    private handleDeviceConnectedRead() {
        this.connecttime = new Date();
        this.writeLog("AM43 connected for data reading");
        const characteristicUUIDs = [NOBLE_BAT_CHAR_UID];
        const serviceUID = [NOBLE_SERVICE_UID];
        this.peripheral.removeAllListeners("servicesDiscover");
        this.peripheral.discoverSomeServicesAndCharacteristics(serviceUID, characteristicUUIDs, this.discoveryResult.bind(this));
    }
    
    private discoveryResult(error: string, services: Service[], characteristics: Characteristic[]) {
        if (error) {
            this.writeLog("ERROR retrieving characteristic");
            this.peripheral.disconnect();
        }
        else {
            this.writeLog("discovered data char");
            const characteristic = characteristics[0];
            characteristic.on("data", (data: string, isNotification: boolean) => {
                this.writeLog("received characteristic update");
                //read data to buffer
                const bfr = Buffer.from(data, "hex");
                //convert to hex string
                const strBfr = bfr.toString("hex", 0, bfr.length);
                this.writeLog("Notification data: " + strBfr);
                const notificationIdentifier = strBfr.substr(2, 2);
                this.writeLog("Notification identifier: " + notificationIdentifier);
                if (batteryNotificationIdentifier === notificationIdentifier) {
                    //battery is hexadecimal on position 14, 2 bytes
                    const batteryHex = strBfr.substr(14, 2);
                    //convert hex number to integer
                    const batteryPercentage = parseInt(batteryHex, 16);
                    this.writeLog(`Bat %: ${batteryPercentage}`);
                    this.batterypercentage = batteryPercentage;
                    this.batterysuccess = true;
                    
                    //write cmd to enable light notification
                    characteristic.write(Buffer.from(HEY_KEY_LIGHT_REQUEST, "hex"), true);
                }
                else if (lightNotificationIdentifier === notificationIdentifier) {
                    //light is byte 4 (ex. 9a aa 02 00 00 32)
                    const lightHex = strBfr.substr(8, 2);
                    //convert to integer
                    const lightPercentage = parseInt(lightHex, 16);
                    this.writeLog(`Light %: ${lightPercentage}`);
                    this.lightpercentage = lightPercentage;
                    this.lightsuccess = true;
                    
                    //write cmd to get position
                    characteristic.write(Buffer.from(HEY_KEY_POSITION_REQUEST, "hex"), true);
                }
                else if (positionNotificationIdentifier === notificationIdentifier) {
                    //position is byte 6: 9a a7 07 0f 32 4e 00 00 00 30 79
                    const positionHex = strBfr.substr(10, 2);
                    //convert to integer
                    const positionPercentage = parseInt(positionHex, 16);
                    this.writeLog(`Position %: ${positionPercentage}`);
                    this.positionpercentage = positionPercentage;
                    this.positionsuccess = true;
                    this.reevaluateState();
                }
                
                if (this.batterysuccess && this.lightsuccess && this.positionsuccess) {
                    this.writeLog("Reading data completed");
                    characteristic.unsubscribe();
                    setTimeout(() => {
                        this.peripheral.disconnect();
                    }, 1000);
                }
            });
            //subscribe to notifications on the char
            characteristic.subscribe();
            //write cmd to enable battery notification
            characteristic.write(Buffer.from(HEX_KEY_BATTERY_REQUEST, "hex"), true);
        }
    }
    
    private performReadData(): void {
        this.batterysuccess = false;
        this.positionsuccess = false;
        this.lightsuccess = false;
        am43.busyDevice = this;
        
        this.peripheral.connect();
        this.peripheral.once("connect", this.handleDeviceConnectedRead.bind(this));
        this.peripheral.once("disconnect", this.disconnectMeRead.bind(this));
    }
    
    private writeKey(handle: number, key: string): void {
        if (am43.busyDevice != null) {
            this.writeLog("Connection busy for other device, waiting...");
            setTimeout(() => {
                this.writeKey(handle, key);
            }, 1000);
            return;
        }
        
        this.performWriteKey(handle, key);
    }
    
    private performWriteKey(handle: number, key: string): void {
        this.success = false;
        am43.busyDevice = this;
        this.peripheral.connect();
        this.peripheral.once("connect", () => {
            this.connecttime = new Date();
            this.writeLog("AM43 connected");
            this.peripheral.writeHandle(Buffer.from(handle.toString(), "hex"), Buffer.from(key, "hex"), true, (error) => {
                if (error) {
                    this.writeLog("ERROR" + error);
                }
                else {
                    this.writeLog("key written");
                    this.success = true;
                }
                
                setTimeout(() => {
                    this.peripheral.disconnect();
                }, 1000);
            });
        });
        
        this.peripheral.once("disconnect", () => {
            this.writeLog("disconnected");
            if (!this.success) {
                if (this.currentRetry < this.maxRetries) {
                    this.writeLog("Writing unsuccessful, retrying in 1 second...");
                    this.currentRetry = this.currentRetry + 1;
                    setTimeout(() => {
                        this.performWriteKey(handle, key);
                    }, 1000);
                }
                else {
                    this.writeLog("Writing unsuccessful, giving up...");
                    am43.busyDevice = null;
                    this.currentRetry = 0;
                }
            }
            else {
                this.writeLog("Writing was successful");
                am43.busyDevice = null;
                this.currentRetry = 0;
                this.emit("stateChanged", () => this.currentState);
                this.scheduleForcedDataRead();
            }
        });
        
    }
    
    public am43Init(poll = 0): void {
        setTimeout(() => {
            this.readData();
        }, 5000);
        
        // FUTURE: User input validation - TBD
        let intervalMS = am43.randomIntMinutes(10, 20);
        if (poll > 0) {
            intervalMS = (3 * 1000 * 60);
        }
        
        const interval = intervalMS;
        this.writeLog(`interval: ${interval}`);
        setInterval(() => {
            this.readData();
        }, interval);
    }
    
    private scheduleForcedDataRead(): void {
        //we read data after 15 seconds (eg. to capture pretty fast the open state)
        setTimeout(() => {
            this.readData();
        }, 15000);
        
        //we read data after fullMovingTime + 5 seconds buffer (eg. to capture the closed state/end position when movement is complete)
        setTimeout(() => {
            this.readData();
        }, fullMovingTime + 5000);
        
        //else we still have our 'slower' backup task which will provide updated data at later time
    }
    
    private static randomIntMinutes(min: number, max: number): number {
        return 1000 * 60 * (Math.floor(Math.random() * (max - min + 1) + min));
    }
    
    private reevaluateState(): void {
        if (this.positionpercentage === 100) {
            this.state = BlindStates.CLOSED;
        }
        else {
            this.state = BlindStates.OPEN;
        }
    }
    
    public am43Open(): void {
        this.writeKey(AM43HANDLE, HEX_KEY_OPEN_BLINDS);
        this.lastaction = IAM43Actions.OPEN;
        this.state = BlindStates.OPEN;
    }
    
    public am43Close(): void {
        this.writeKey(AM43HANDLE, HEX_KEY_CLOSE_BLINDS);
        this.lastaction = IAM43Actions.CLOSE;
        
        this.state = BlindStates.CLOSED;
    }
    
    public am43Stop(): void {
        this.writeKey(AM43HANDLE, HEX_KEY_STOP_BLINDS);
        this.lastaction = IAM43Actions.STOP;
        this.state = BlindStates.OPEN;
    }
    
    public am43GotoPosition(position: number): void {
        const positionHex = position.toString(16).padStart(2, "0");
        
        const buffer = Buffer.from(HEY_KEY_POSITION_BLIND_FIXED_CRC_CONTENT + positionHex, "hex");
        let crc = buffer[0];
        for (let i = 1, length = buffer.length; i < length; ++i) {
            crc = crc ^ buffer[i];
        }
        
        this.writeKey(AM43HANDLE, HEX_KEY_POSITION_BLINDS_PREFIX + HEY_KEY_POSITION_BLIND_FIXED_CRC_CONTENT + positionHex + crc.toString(16));
        this.lastaction = IAM43Actions.SET_POSITION;
        if (position === 100) {
            this.state = BlindStates.CLOSED;
        }
        else {
            this.state = BlindStates.OPEN;
        }
    }
    
    public get currentState(): IAM43Status {
        return {
            id : this.id,
            lastconnect : this.connecttime,
            lastsuccess : this.successtime,
            lastaction : this.lastaction,
            state : this.state,
            battery : this.batterypercentage,
            light : this.lightpercentage,
            position : this.positionpercentage
        };
    }
}

module.exports = am43;