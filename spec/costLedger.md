# Meter service costs

The service records estimated or provider-priced costs by app and UTC date. The shell owns provider calls, configured currency parsing, fractional arithmetic, ledger IDs, persistence, and logs. It supplies operational codes and counts without member IDs, phone numbers, or message contents. The shell records a code send's cost only after the named provider completes that send.

## Story: Know the cost of paid service work

> As an operator, I want to see the cost of paid attempts without charging activity a provider did not receive.

### Use the configured rates and the existing defaults

A configured rate or budget must parse to a finite, nonnegative number. Zero is a valid override. Missing Twilio, photo, and SMS rates use their existing defaults. Blooio defaults to one line. Monthly line and per-call relay overrides have no default provider charge of their own. Store a negative event cost at zero. Decimal conversion and computation stay in the shell.

```quint
pure val costMicrosPerUsd: int = 1000000
pure val defaultTwilioVerifyMicros: int = 58000
pure val defaultClefPhotoMicros: int = 425
pure val defaultSmsMicros: int = 8300
pure val defaultBlooioLines: int = 1
pure val costAccrualDaysPerMonth: int = 30

pure def costOverrideValid(finite: bool, amount: int): bool = finite and amount >= 0
pure def costAmountWithFloor(amount: int): int = if (amount <= 0) 0 else amount

pure def lawCostFloorIsNonnegative(amount: int): bool = costAmountWithFloor(amount) >= 0
```

### Charge code sends, photo tries, and priced model attempts

Blooio code sends use the SMS estimate. Twilio code sends use the verification estimate. The photo meter counts each actual try, including an error, with a quantity of at least one. A null result or the disabled rater has no charge. An LLM attempt is recorded only when its reported micro-dollar cost is positive.

```quint
type OtpCostBasis = OtpUnmetered | OtpSmsEstimate | OtpVerifyEstimate
pure def otpCostBasis(provider: str, twilioProvider: bool): OtpCostBasis =
  if (provider == "blooio") OtpSmsEstimate else if (twilioProvider) OtpVerifyEstimate else OtpUnmetered

pure def photoRaterIsMetered(provider: str): bool = provider != "none"
pure def photoResultIsBillable(refused: bool): bool = not(refused)
pure def meteredPhotoQuantity(photos: int): int = if (photos > 1) photos else 1
pure def llmAttemptIsPriced(costMicro: int): bool = costMicro > 0
```

### Relay classification charges only a provider attempt

A success, an error, or a timeout can be billed by the relay provider. A cached answer or a miss does not create a charge. When a fixed price is configured, use it for the attempt. Otherwise use the existing model's input-token price and the shell's fallback when token counts are missing.

```quint
type RelayCostBasis = RelayUnmetered | RelayFixedPrice | RelayTokenPrice
pure def relayCostBasis(providerOutcome: str, fixedPrice: bool): RelayCostBasis =
  if (providerOutcome == "ok" or providerOutcome == "error" or providerOutcome == "timeout") {
    if (fixedPrice) RelayFixedPrice else RelayTokenPrice
  } else RelayUnmetered

pure def lawRelayCacheCostsNothing(fixedPrice: bool): bool =
  relayCostBasis("cached", fixedPrice) == RelayUnmetered
```

## Story: Report the spend against a daily budget

> As an operator, I want daily recurring costs and SMS fallbacks to be included once, with the current usage of each enabled budget.

### Accrue configured line costs and show positive budgets

Accrue the line charge only when line accrual is enabled, a monthly price is configured, and the number of lines is positive. Use a thirty-day divisor. Daily line and SMS rows use their existing stable IDs so the same day can be recomputed. Include a budget line only for a positive budget. Keep the unrounded amount for the usage share and the existing rounding for display.

```quint
pure def dailyCostIncludesLine(accrueLine: bool, monthlyKnown: bool, lines: int): bool =
  accrueLine and monthlyKnown and lines > 0

pure def costBudgetIsEnabled(budget: int): bool = budget > 0

pure def lawZeroBudgetIsDisabled(budget: int): bool =
  budget == 0 implies not(costBudgetIsEnabled(budget))
```
