import type {BlindStates} from "class/BlindStates";
import type {AM43Actions} from "class/AM43Actions";
import type {DateTime} from "luxon";

export default interface IAM43Status {
    id?: string
    lastConnect?: DateTime | null
    lastSuccess?: DateTime | null
    lastAction: AM43Actions
    state: BlindStates
    battery?: number | null
    light?: number | null
    position?: number | null
}