export enum AM43Actions {
    OPEN,
    CLOSE,
    STOP,
    SET_POSITION,
    NONE
}

export const actionKeys: Record<AM43Actions, string> = {
    [AM43Actions.OPEN]: "00ff00009a0d010096",
    [AM43Actions.CLOSE]: "00ff00009a0d0164f2",
    [AM43Actions.STOP]: "00ff00009a0a01cc5d",
    [AM43Actions.SET_POSITION]: "0",
    [AM43Actions.NONE]: "0"
}
