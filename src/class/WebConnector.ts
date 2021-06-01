import express, { Express, Request, Response } from "express";
import am43 from "class/am43";
import debug from "debug";
import IAM43Status from "interface/IAM43Status";

export default class WebConnector {
    
    private express: Express;
    
    constructor(private devices: Record<string, am43>, port: number, private log: debug.Debugger) {
        this.express = express();
        this.setupExpressRoutes();
        this.log = log;
        this.log("listening on port %d", port);
        this.express.listen(port);
    }
    
    setupExpressRoutes(): void {
        this.express.get("/", (req, res) => {
            const output: Record<string, IAM43Status> = {};
            Object.entries(this.devices).forEach(([id, device]) => output[id] = device.currentState);
            res.json(output);
        });
        
        this.express.get("/:am43Id", (req, res) => {
            const device = this.requireDevice(req, res);
            if (device) {
                res.json(device.currentState);
            }
        });
        
        this.express.post("/:am43Id/open", (req, res) => {
            const device = this.requireDevice(req, res);
            if (device) {
                device.log("requesting AM43 open");
                device.am43Open();
                res.sendStatus(200);
            }
            
        });
        
        this.express.post("/:am43Id/close", (req, res) => {
            const device = this.requireDevice(req, res);
            if (device) {
                device.log("requesting AM43 close");
                device.am43Close();
                res.sendStatus(200);
            }
            
        });
        
        this.express.post("/:am43Id/stop", (req, res) => {
            const device = this.requireDevice(req, res);
            if (device) {
                device.log("requesting AM43 stop");
                device.am43Stop();
                res.sendStatus(200);
            }
            
        });
    }
    
    requireDevice(req: Request, res: Response): am43 | undefined {
        const device = this.devices[req.params.am43Id];
        if (device) {
            return device;
        }
        res.sendStatus(404);
    }
}

module.exports = WebConnector;