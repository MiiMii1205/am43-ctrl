import mqtt from "mqtt";
import am43 from "./am43";
import { IAM43Actions } from "./IAM43Actions";

const coverTopic = "cover/";
const sensorTopic = "sensor/";

export default class MQTTConnector {
    constructor(device: am43, mqttUrl: string, baseTopic: string, username: string, password: string) {
        const mqttClient = mqtt.connect(mqttUrl, {
            will : {
                topic : `${baseTopic}${coverTopic}${device.id}/connection`,
                payload : "Offline",
                qos : 0,
                retain : true
            },
            username : username,
            password : password
        });
        
        const deviceTopic = `${baseTopic}${coverTopic}${device.id}`;
        const deviceBatterySensorConfigTopic = `${baseTopic}${sensorTopic}${device.id}_battery`;
        const deviceLightSensorConfigTopic = `${baseTopic}${sensorTopic}${device.id}_light`;
        mqttClient.subscribe([`${deviceTopic}/set`]);
        mqttClient.subscribe([`${deviceTopic}/setposition`]);
        
        mqttClient.on("message", (topic, message) => {
            device.log("mqtt message received %o, %o", topic, message.toString());
            
            if (message.length > 0) {
                if (topic.endsWith("set")) {
                    if (message.toString().toLowerCase() === "open") {
                        device.log("requesting cover open");
                        device.am43Open();
                    }
                    else if (message.toString().toLowerCase() === "close") {
                        device.log("requesting cover close");
                        device.am43Close();
                    }
                    else if (message.toString().toLowerCase() === "stop") {
                        device.log("requesting cover stop");
                        device.am43Stop();
                    }
                }
                else if (topic.endsWith("setposition")) {
                    device.log(`requesting position ${message}`);
                    device.am43GotoPosition(parseInt(message.toString(), 10));
                }
            }
            
        });
        
        const deviceInfo = {
            identifiers : `am43_${device.id}`,
            name : device.id,
            manufacturer : "Generic AM43"
        };
        
        const coverConfig = {
            name : device.id,
            command_topic : `${deviceTopic}/set`,
            position_topic : `${deviceTopic}/state`,
            set_position_topic : `${deviceTopic}/setposition`,
            position_open : 0,
            position_closed : 100,
            availability_topic : `${deviceTopic}/connection`,
            payload_available : "Online",
            payload_not_available : "Offline",
            payload_open : IAM43Actions.OPEN,
            payload_close : IAM43Actions.CLOSE,
            payload_stop : IAM43Actions.STOP,
            position_template : "{{value_json['position']}}",
            unique_id : `am43_${device.id}_cover`,
            device : deviceInfo
        };
        
        const batterySensorConfig = {
            name : `${device.id} Battery`,
            state_topic : `${deviceTopic}/state`,
            availability_topic : `${deviceTopic}/connection`,
            payload_available : "Online",
            payload_not_available : "Offline",
            unique_id : `am43_${device.id}_battery_sensor`,
            device : deviceInfo,
            value_template : "{{value_json['battery']}}",
            device_class : "battery",
            unit_of_measurement : "%"
        };
        
        const lightSensorConfig = {
            name : `${device.id} Light`,
            state_topic : `${deviceTopic}/state`,
            availability_topic : `${deviceTopic}/connection`,
            payload_available : "Online",
            payload_not_available : "Offline",
            unique_id : `am43_${device.id}_light_sensor`,
            device : deviceInfo,
            value_template : "{{value_json['light']}}",
            unit_of_measurement : "%"
        };
        
        device.log(`mqtt topic ${deviceTopic}`);
        
        device.on("stateChanged", (data) => {
            device.log(`state changed received: ${JSON.stringify(data)}`);
            mqttClient.publish(`${deviceTopic}/state`, JSON.stringify(data), {
                qos : 0,
                retain : true
            });
        });
        
        mqttClient.on("connect", () => {
            const id: string | undefined = device.currentState.id;
            coverConfig.name = id;
            coverConfig.device.name = id;
            
            mqttClient.publish(`${deviceTopic}/config`, JSON.stringify(coverConfig), {
                retain : true,
                qos : 0
            });
            mqttClient.publish(`${deviceBatterySensorConfigTopic}/config`, JSON.stringify(batterySensorConfig), {
                retain : true,
                qos : 0
            });
            mqttClient.publish(`${deviceLightSensorConfigTopic}/config`, JSON.stringify(lightSensorConfig), {
                retain : true,
                qos : 0
            });
            mqttClient.publish(`${deviceTopic}/connection`, "Online", {
                retain : true,
                qos : 0
            });
            device.log("mqtt connected");
        });
        mqttClient.on("end", () => device.log("mqtt ended"));
        mqttClient.on("error", (e) => device.log("mqtt error %o", e));
        mqttClient.on("offline", () => device.log("mqtt offline"));
        mqttClient.on("close", () => device.log("mqtt close"));
        
    }
}

module.exports = MQTTConnector;