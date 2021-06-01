import { BlindStates } from "class/BlindStates";
import { IAM43Actions } from "class/IAM43Actions";

export default interface IAM43Status {
    id?: string
    lastconnect?: Date | null
    lastsuccess?: Date | null
    lastaction: IAM43Actions
    state: BlindStates
    battery?: number | null
    light?: number | null
    position?: number | null
}