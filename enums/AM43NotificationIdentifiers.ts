export enum AM43NotificationIdentifiers {
    BATTERY = "a2",
    POSITION = "a7",
    LIGHT = "aa"
}

export const identifierRequestsKeys: Record<AM43NotificationIdentifiers, string> = {
    [AM43NotificationIdentifiers.POSITION]: "00ff00009aa701013d",
    [AM43NotificationIdentifiers.LIGHT]: "00ff00009aaa010130",
    [AM43NotificationIdentifiers.BATTERY]: "00ff00009aa2010138",
}
