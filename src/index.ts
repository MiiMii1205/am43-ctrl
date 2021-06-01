#!/usr/bin/env node

import debug from "debug";
import am43 from "./class/am43";
import moment from "moment";

import yargs from "yargs";

import noble, { Peripheral } from "@abandonware/noble";

import readlineSync from "readline-sync";

import mqttBinding from "./class/MQTTConnector";

import WebBinding from "./class/WebConnector";
import assert from "assert";

const log = debug("am43*");
const debugLog = debug("am43");

const args = yargs
    .usage("Usage: $0 MAC1 MAC2 --express-port 3000 --url [mqtt|ws][s]://yourbroker.example.com")
    .example("$0 MAC1 MAC2 --url [broker_url]", "Connect to devices with specific IDs only, publish to MQTT")
    .options({
        "d" : {
            alias : "debug",
            describe : "Enable debug logging",
            type : "boolean"
        },
        "l" : {
            alias : "express-port",
            describe : "Port for express web server (if unset, express will not startup)",
            type : "number"
        },
        "url" : {
            alias : "mqtt-url",
            describe : "MQTT broker URL"
        },
        "topic" : {
            alias : "mqtt-base-topic",
            describe : "Base topic for MQTT",
            default : "homeassistant"
        },
        "p" : {
            alias : "mqtt-password",
            describe : "Password for MQTT (if not specified as an argument, will prompt for password at startup)"
        },
        "u" : {
            alias : "mqtt-username",
            describe : "Username for MQTT"
        },
        "i" : {
            alias : "interval",
            describe : "Minutes interval for device polling (default is random 10 to 20)",
            type : "number",
            default : 0
        },
        "f" : {
            alias : "fail-time",
            describe : "Seconds since last successful device connection before program exit (default is never exit)",
            type : "number",
            default : 0
        }
    })
    .wrap(yargs.terminalWidth())
    .env("AM43");

Promise.resolve(args.argv).then((argv) => {
    
    if (argv.d) {debugLog.enabled = true;}
    
    if (!argv.url && !argv.l) {
        log("ERROR: Neither --express-port or --mqtt-url supplied, nothing to do");
        yargs.showHelp();
        process.exit(-1);
    }
    
    if (argv.p === true) {
        argv.p = readlineSync.question("MQTT Password: ", {
            hideEchoBack : true,
            mask : ""
        });
    }
    
    const idsToConnectTo = argv._.filter(name => (typeof name === "number") || !name.startsWith("_")).map(name => (typeof name === "number") ? name : name.replace(/:/g, "").toLowerCase());
    
    if (idsToConnectTo.length === 0) {
        log("ERROR: No MACs defined");
        yargs.showHelp();
        process.exit(-1);
    }
    
    argv.expectedDevices = idsToConnectTo.length;
    
    const devices: Record<string, am43> = {};
    const ids: string[] = [];
    let failConnectCount = 0;
    
    noble.on("stateChange", async (state) => {
        if (state === "poweredOn") {
            await noble.startScanningAsync([], false);
        }
    });
    
    if (argv.expectedDevices) {
        log("scanning for %d device(s) %o", argv.expectedDevices, idsToConnectTo);
    }
    else {
        log("scanning for as many devices until timeout");
    }
    
    const failTime = argv.f as number;
    const interval = argv.i as number;
    
    let baseTopic = argv.topic as string;
    if (!baseTopic.endsWith("/")) {
        baseTopic = `${baseTopic}/`;
    }
    
    const mqttUrl = argv.url as string;
    const mqttUsername = argv.u as string;
    const mqttPassword = argv.p as string;
    let poll = 0;
    
    const expressPort = argv.l as number;
    let webBindingInstance;
    if (expressPort) {
        webBindingInstance = new WebBinding(devices, expressPort, debugLog);
    }
    noble.on("warning", (message: string) => {debugLog(message);});
    let lastSuccess: Date | null;
    let secondsDiff: number;
    
    function intervalFunc() {
        const now = moment();
        lastSuccess = null;
        // Get most recent successtime from any device
        for (const id of ids) {
            const deviceSuccessTime: Date | null = devices[id].successtime;
            if (lastSuccess == null || (deviceSuccessTime != null && deviceSuccessTime > lastSuccess)) {
                lastSuccess = deviceSuccessTime;
            }
        }
        
        if (lastSuccess == null) {
            // No device has connected yet
            failConnectCount++;
            lastSuccess = new Date();
            if (failConnectCount > 10) {
                log("Exiting since no device has every connected...");
                process.exit(-2);
            }
            
        }
        secondsDiff = now.diff(lastSuccess, "seconds");
        debugLog("Time since last successful connect: %s", secondsDiff);
        if ((failTime > 0) && (secondsDiff > failTime)) {
            log("Exiting since max time since last successful connection has elapsed...");
            //noble.reset();
            
            // IN-WORK
            
            process.exit(-3);
        }
    }
    
    // Execute intervalFunc every minute
    setInterval(intervalFunc, 60000);
    
    noble.on("discover", async (peripheral: Peripheral) => {
        const id: string | undefined = peripheral.address !== undefined ? peripheral.address.replace(/:/g, "").toLowerCase() : undefined;
        
        assert(id != null, `Invalid Id`);
        assert(idsToConnectTo.indexOf(id) !== -1, `Found ${id} but will not connect as it was not specified in the list of devices ${idsToConnectTo}`);
        
        devices[id] = new am43(id, peripheral);
        if (argv.debug) {devices[id].log.enabled = true;}
        
        log("discovered %s", id);
        ids.push(id);
        if (Object.keys(devices).length === argv.expectedDevices) {
            log("all expected devices connected, stopping scan");
            await noble.stopScanningAsync();
            
            Object.values(devices).forEach((device) => {
                if (mqttUrl) {
                    new mqttBinding(device, mqttUrl, baseTopic, mqttUsername, mqttPassword);
                }
                poll = interval;
                device.am43Init(poll);
            });
        }
        
    });
});