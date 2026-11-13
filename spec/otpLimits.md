# Phone verification limits

## Story: Prove ownership of my phone

> As a person signing up, I want a short-lived code and consistent limits that keep the phone verification service usable.

### Verification codes expire and have a limited number of attempts

The default code lifetime is ten minutes. Each challenge allows up to five attempts. The store checks lifetime and remaining attempts at verification and consumes a successful challenge once.

```quint
pure val otpLifetimeMs: int = 10 * 60 * 1000
pure val otpChallengeMaxAttempts: int = 5
```

### Code sends have limits shared across apps

The same number can request at most three codes per hour and six per day, with at least thirty seconds between requests. Limit each client address bucket to ten requests per hour and the whole service to five hundred requests per hour. The service and store own request ordering and persistence.

```quint
pure val otpSendsPerPhoneHour: int = 3
pure val otpSendsPerPhoneDay: int = 6
pure val otpSendsPerIpHour: int = 10
pure val otpSendGapMs: int = 30 * 1000
pure val otpSendsGlobalHour: int = 500
```

### Code checks also have limits shared across apps

Allow up to ten code checks per number per hour and thirty per address bucket per hour across all apps. These defaults apply independently of the individual challenge's attempt limit.

```quint
pure val otpChecksPerPhoneHour: int = 10
pure val otpChecksPerIpHour: int = 30
```
