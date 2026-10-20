// A reported app-world gate. The app owns its threshold and scoring rules.
export interface GateResult { id: string; gate: string; value: string; pass: boolean }
