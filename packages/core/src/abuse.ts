/** Terminal intimidation or a stated harmful consequence after “or else”. */
export const OR_ELSE_THREAT = String.raw`\bor else\b(?=\s*[.!?…,;:)]*\s*$`
  + String.raw`|\s+(?:\b(?:you|u)(?:'ll| will| would)\s+(?:regret|be sorry|pay for)\b`
  + String.raw`|\b(?:i|we|he|she|they)(?:'ll| will| would|'m gonna| am going to)\s+`
  + String.raw`(?:make (?:you|them) (?:sorry|regret|pay)|show up (?:at|outside) (?:your|their|her|his) (?:home|place|work|office|door))\b))`;
