import type {BlindStates} from "class/BlindStates";
import type {IAM43Actions} from "class/IAM43Actions";
import type {DateTime} from "luxon";

export default interface IAM43Status {
    id?: string
    lastconnect?: DateTime | null
    lastsuccess?: DateTime | null
    lastaction: IAM43Actions
    state: BlindStates
    battery?: number | null
    light?: number | null
    position?: number | null
}