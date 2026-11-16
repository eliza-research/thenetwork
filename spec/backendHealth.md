# Backend health checks

The public health endpoint reports whether the process is serving, its database responds, and its network ticks are current. The [backend lifecycle](backendLifecycle.md) owns the serving state and tick timer. The database ping and tick clock remain effects.

## Story: Tell operators when a backend cannot serve

> As an operator, I want a health check to report whether the backend is ready, so the host and uptime monitor can detect a failed instance.

### Admit the check before reading the database

Read the process's serving state when the request starts. A draining process reports `draining` without checking the database. An admitted check continues using that admission while the ping is pending.

```quint
type HealthStatus = Ready | Draining | DatabaseDown | TickLate
type BackendHealth = CheckingAdmission | CheckingDatabase | CheckingTicks | Reported({ status: HealthStatus })

pure val initial: BackendHealth = CheckingAdmission

pure def canCheckAdmission(s: BackendHealth): bool = s == CheckingAdmission
pure def checkAdmission(s: BackendHealth, serving: bool): BackendHealth =
  if (serving) CheckingDatabase else Reported({ status: Draining })
```

### Read tick lateness only after a successful database ping

A false result or a rejected database ping reports `database`. A successful ping permits the shell to read tick lateness. When at least one network tick is late, report `tick_late`. Otherwise report `ok`. The HTTP shell sends 200 for `ok` and 503 for the other reports.

```quint
pure def canCheckDatabase(s: BackendHealth): bool = s == CheckingDatabase
pure def checkDatabase(s: BackendHealth, reachable: bool): BackendHealth =
  if (reachable) CheckingTicks else Reported({ status: DatabaseDown })

pure def canCheckTicks(s: BackendHealth): bool = s == CheckingTicks
pure def checkTicks(s: BackendHealth, late: bool): BackendHealth =
  Reported({ status: if (late) TickLate else Ready })

pure def stepReportIsFinal(before: BackendHealth, after: BackendHealth): bool =
  match before {
    | Reported(_) => after == before
    | _ => true
  }

pure def sometimesReportsReady(s: BackendHealth): bool = s == Reported({ status: Ready })
pure def sometimesReportsDraining(s: BackendHealth): bool = s == Reported({ status: Draining })
pure def sometimesReportsDatabaseDown(s: BackendHealth): bool = s == Reported({ status: DatabaseDown })
pure def sometimesReportsLateTick(s: BackendHealth): bool = s == Reported({ status: TickLate })
```
