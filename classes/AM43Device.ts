import EventEmitter from "events";

import debug from "debug";
import type {Peripheral} from "@abandonware/noble";
import type IAM43Status from "../interfaces/IAM43Status";
import {BlindStates} from "../enums/BlindStates";
import {actionKeys, AM43Actions} from "../enums/AM43Actions";
import {DateTime} from "luxon";
import {AM43NotificationIdentifiers, identifierRequestsKeys} from "../enums/AM43NotificationIdentifiers";

const serviceUUID = "0000fe5000001000800000805f9b34fb";
const am43CharUUID = "0000fe5100001000800000805f9b34fb";

const NOBLE_SERVICE_UID = "fe50";
const NOBLE_BAT_CHAR_UID = "fe51";

const characteristicUUIDs = [NOBLE_BAT_CHAR_UID];
const serviceUID = [NOBLE_SERVICE_UID];

const AM43HANDLE = 0x000e as unknown as Buffer;

const HEX_KEY_POSITION_BLINDS_PREFIX = "00ff0000";
const HEY_KEY_POSITION_BLIND_FIXED_CRC_CONTENT = "9a0d01";

const fullMovingTime = 137000;
const maxRetries = 30

export default class AM43Device extends EventEmitter {
    private static busyDevice: AM43Device | null = null;
    public log: debug.Debugger;
    public successTime: DateTime | null;
    private currentRetry: number;
    private success: boolean;
    private batterySuccess: boolean;
    private lightSuccess: boolean;
    private positionSuccess: boolean;
    private state: BlindStates;
    private lastAction: AM43Actions;
    private connectTime: DateTime | null;
    private batteryPercentage: number | null;
    private lightPercentage: number | null;
    private positionPercentage: number | null;

    constructor(public id: string | undefined, private peripheral: Peripheral) {
        super();
        this.log = debug(`am43:${id}`);
        this.connectTime = null;
        this.successTime = null;
        this.lastAction = AM43Actions.NONE;
        this.state = BlindStates.UNKNOWN;
        this.currentRetry = 0;
        this.success = false;
        this.batterySuccess = false;
        this.lightSuccess = false;
        this.positionSuccess = false;
        this.batteryPercentage = null;
        this.lightPercentage = null;
        this.positionPercentage = null;
    }

    public get currentState(): IAM43Status {
        return {
            id: this.id,
            lastConnect: this.connectTime,
            lastSuccess: this.successTime,
            lastAction: this.lastAction,
            state: this.state,
            battery: this.batteryPercentage,
            light: this.lightPercentage,
            position: this.positionPercentage
        };
    }

    private static randomIntMinutes(min: number, max: number): number {
        return 1000 * 60 * (Math.floor(Math.random() * (max - min + 1) + min));
    }

    public am43Init(poll = 0): void {
        setTimeout(() =>
                this.readData()
            , 5000);

        // FUTURE: User input validation - TBD
        let intervalMS = AM43Device.randomIntMinutes(10, 20);
        if (poll > 0) {
            intervalMS = (3 * 1000 * 60);
        }

        const interval = intervalMS;
        this.writeLog(`interval: ${interval}`);
        setInterval(() =>
                this.readData()
            , interval);
    }

    public async am43Open(): Promise<void> {
        await this.writeKey(AM43HANDLE, actionKeys[AM43Actions.OPEN]);
        this.lastAction = AM43Actions.OPEN;
        this.state = BlindStates.OPEN;
    }

    public async am43Close(): Promise<void> {
        await this.writeKey(AM43HANDLE, actionKeys[AM43Actions.CLOSE]);
        this.lastAction = AM43Actions.CLOSE;
        this.state = BlindStates.CLOSED;
    }

    public async am43Stop(): Promise<void> {
        await this.writeKey(AM43HANDLE, actionKeys[AM43Actions.STOP]);
        this.lastAction = AM43Actions.STOP;
        this.state = BlindStates.OPEN;
    }

    public async am43GotoPosition(position: number): Promise<void> {
        const positionHex = position.toString(16).padStart(2, "0");

        const buffer = Buffer.from(HEY_KEY_POSITION_BLIND_FIXED_CRC_CONTENT + positionHex, "hex");
        let crc = buffer[0];
        for (let i = 1, length = buffer.length; i < length; ++i) {
            crc = crc ^ buffer[i];
        }

        await this.writeKey(AM43HANDLE, HEX_KEY_POSITION_BLINDS_PREFIX + HEY_KEY_POSITION_BLIND_FIXED_CRC_CONTENT + positionHex + crc.toString(16));
        this.lastAction = AM43Actions.SET_POSITION;
        this.reevaluateState(position)
    }

    private writeLog(pLogLine: string | number): void {
        this.log(pLogLine);
    }

    private async readData(): Promise<void> {
        if (AM43Device.busyDevice == null) {
            return this.performReadData();
        } else {
            this.writeLog(`Connection busy for other device ${AM43Device.busyDevice.id}, delaying data read...`);
            setTimeout(() =>
                    this.readData()
                , 1000);
        }
    }

    private disconnectMeRead(): void {
        this.writeLog("disconnected for data reading");

        if (!this.batterySuccess || !this.positionSuccess || !this.lightSuccess) {
            if (this.currentRetry < maxRetries) {
                this.writeLog("Reading data unsuccessful, retrying in 1 second...");
                this.currentRetry = this.currentRetry + 1;
                setTimeout(() =>
                        this.performReadData()
                    , 1000);
            } else {
                this.writeLog("Reading data unsuccessful, giving up...");
                AM43Device.busyDevice = null;
                this.currentRetry = 0;
            }
        } else {
            this.writeLog("Reading data was successful");
            this.successTime = DateTime.now();
            AM43Device.busyDevice = null;
            this.currentRetry = 0;
            this.emit("stateChanged", this.currentState);
        }
    }

    private async handleDeviceConnectedRead(): Promise<void> {
        this.connectTime = DateTime.now();
        this.writeLog("AM43 connected for data reading");
        this.peripheral.removeAllListeners("servicesDiscover");

        try {
            const {
                characteristics
            } = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(serviceUID, characteristicUUIDs);

            this.writeLog("discovered data char");
            const [characteristic] = characteristics

            characteristic.on("data", async (data: string, isNotification: boolean) => {
                this.writeLog("received characteristic update");
                //read data to buffer
                const bfr = Buffer.from(data, "hex");
                //convert to hex string
                const strBfr = bfr.toString("hex", 0, bfr.length);
                this.writeLog(`Notification data: ${strBfr}`);
                const notificationIdentifier = strBfr.substr(2, 2);
                this.writeLog(`Notification identifier: ${notificationIdentifier}`);

                switch (notificationIdentifier) {
                    case AM43NotificationIdentifiers.BATTERY:
                        //battery is hexadecimal on position 14, 2 bytes
                        const batteryHex = strBfr.substr(14, 2);
                        //convert hex number to integer
                        const batteryPercentage = parseInt(batteryHex, 16);
                        this.writeLog(`Bat: ${batteryPercentage}%`);
                        this.batteryPercentage = batteryPercentage;
                        this.batterySuccess = true;

                        //write cmd to enable light notification
                        await characteristic.writeAsync(Buffer.from(identifierRequestsKeys[AM43NotificationIdentifiers.LIGHT], "hex"), true)
                        break;
                    case AM43NotificationIdentifiers.LIGHT:
                        //light is byte 4 (ex. 9a aa 02 00 00 32)
                        const lightHex = strBfr.substr(8, 2);
                        //convert to integer
                        const lightPercentage = parseInt(lightHex, 16);
                        this.writeLog(`Light %: ${lightPercentage}`);
                        this.lightPercentage = lightPercentage;
                        this.lightSuccess = true;

                        //write cmd to get position
                        await characteristic.writeAsync(Buffer.from(identifierRequestsKeys[AM43NotificationIdentifiers.POSITION], "hex"), true)
                        break;
                    case AM43NotificationIdentifiers.POSITION:
                        //position is byte 6: 9a a7 07 0f 32 4e 00 00 00 30 79
                        const positionHex = strBfr.substr(10, 2);
                        //convert to integer
                        const positionPercentage = parseInt(positionHex, 16);
                        this.writeLog(`Position: ${positionPercentage}%`);
                        this.positionPercentage = positionPercentage;
                        this.positionSuccess = true;
                        this.reevaluateState();
                        break;
                    default:
                        this.writeLog(`Unknown identifier: ${notificationIdentifier}`)
                        break;
                }

                if (this.batterySuccess && this.lightSuccess && this.positionSuccess) {
                    this.writeLog("Reading data completed");
                    await characteristic.unsubscribeAsync();
                    setTimeout(() =>
                            this.peripheral.disconnectAsync()
                        , 1000);
                }
            });
            //subscribe to notifications on the char
            await characteristic.subscribeAsync();
            //write cmd to enable battery notification
            await characteristic.writeAsync(Buffer.from(identifierRequestsKeys[AM43NotificationIdentifiers.BATTERY], "hex"), true);

        } catch (e) {
            this.writeLog("ERROR retrieving characteristic");
            console.error("ERROR:", e)
            await this.peripheral.disconnectAsync();
        }

    }

    private async performReadData(): Promise<void> {
        this.batterySuccess = false;
        this.positionSuccess = false;
        this.lightSuccess = false;
        AM43Device.busyDevice = this;

        this.peripheral
            .once("connect", this.handleDeviceConnectedRead.bind(this))
            .once("disconnect", this.disconnectMeRead.bind(this));

        return this.peripheral.connectAsync();
    }

    private async writeKey(handle: Buffer, key: string): Promise<void> {
        if (AM43Device.busyDevice != null) {
            this.writeLog("Connection busy for other device, waiting...");
            setTimeout(() => this.writeKey(handle, key), 1000);
        } else {
            return this.performWriteKey(handle, key);
        }
    }

    private async performWriteKey(handle: Buffer, key: string): Promise<void> {
        this.success = false;
        AM43Device.busyDevice = this;
        await this.peripheral.connect();

        this.peripheral.once("connect", async () => {

            try {
                this.connectTime = DateTime.now();
                this.writeLog("AM43 connected");
                await this.peripheral.writeHandleAsync(handle, Buffer.from(key, "hex"), true)
                this.success = true;
                this.writeLog("key written");
            } catch (e) {
                console.error("ERROR:", e)
            }

            setTimeout(() =>
                    this.peripheral.disconnectAsync()
                , 1000);

        }).once("disconnect", () => {
            this.writeLog("disconnected");
            if (!this.success) {
                if (this.currentRetry < maxRetries) {
                    this.writeLog("Writing unsuccessful, retrying in 1 second...");
                    this.currentRetry = this.currentRetry + 1;
                    setTimeout(() =>
                            this.performWriteKey(handle, key)
                        , 1000);
                } else {
                    this.writeLog("Writing unsuccessful, giving up...");
                    AM43Device.busyDevice = null;
                    this.currentRetry = 0;
                }
            } else {
                this.writeLog("Writing was successful");
                AM43Device.busyDevice = null;
                this.currentRetry = 0;
                this.emit("stateChanged", this.currentState);
                this.scheduleForcedDataRead();
            }
        });

    }

    private scheduleForcedDataRead(): void {
        //we read data after 15 seconds (eg. to capture pretty fast the open state)
        setTimeout(() =>
                this.readData()
            , 15000);

        //we read data after fullMovingTime + 5 seconds buffer (eg. to capture the closed state/end position when movement is complete)
        setTimeout(() =>
                this.readData()
            , fullMovingTime + 5000);

        //else we still have our 'slower' backup task which will provide updated data at later time
    }

    private reevaluateState(position = this.positionPercentage): void {
        if (position === 100) {
            this.state = BlindStates.CLOSED;
        } else {
            this.state = BlindStates.OPEN;
        }
    }
}