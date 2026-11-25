import { describe, expect, test } from "vitest";
import { findLeaks } from "../src/guard.ts";

describe("LeakGuard phone reference exemptions", () => {
  test.each([
    "my id 2125550102",
    "ref 2125550102, text me",
    "acct 12125550102",
    "id 2125550102",
    "my id: 2125550102",
    "case 2125550102",
    "ref 212-555-0102",
    "account 2125550102",
    "order #2125550102",
    "#2125550102",
    "ticket 12125550102",
    "id +44 7911 123456",
  ])("blocks phone number after a reference keyword: %s", text => {
    expect(findLeaks(text)).toContain("contact:phone");
  });

  test.each([
    "Your order #1234567890 is confirmed.",
    "Your order #1034567890 is confirmed.",
    "Booking ref 2100550102 at the front desk.",
    "Tracking 940011189922385536",
    "Booking ref 555-0102",
    "Your order #555·0102 is confirmed.",
  ])("keeps non-phone reference numbers clean: %s", text => {
    expect(findLeaks(text)).toEqual([]);
  });
});
