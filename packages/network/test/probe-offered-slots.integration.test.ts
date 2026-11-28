import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import type { NetworkState } from "../src/network.ts";
import { Mini } from "./mini.ts";

const thursday = { label: "Thursday 7pm", start: Date.UTC(2026, 9, 15, 23) };
const friday = { label: "Friday 7pm", start: Date.UTC(2026, 9, 16, 23) };
const saturday = { label: "Saturday 11am", start: Date.UTC(2026, 9, 17, 15) };
const earlierSaturday = { label: "Saturday 10am", start: Date.UTC(2026, 9, 17, 14) };
const sunday = { label: "Sunday 2pm", start: Date.UTC(2026, 9, 18, 18) };
const saturdayLate = { label: "Saturday 11pm", start: Date.UTC(2026, 9, 18, 3) };
const three = [thursday, saturday, sunday];
const weekend = [saturday.start, sunday.start];
const clarifyTime = "Which of the offered times work for you? Reply with the letters or the times.";

type Scenario = {
  scene: string;
  slots: typeof three;
  text: string;
  picked: number[];
  legacyClarification?: true;
  generalPrelude?: true;
  followUp?: { text: string; picked: number[]; closeReason?: string; restart?: true; general?: true; unqualified?: string[] };
};

const scenarios: Scenario[] = [
  { scene: "both names and a separate refusal leave another time unmentioned",
    slots: [thursday, friday, saturday, sunday], text: "Both Saturday and Sunday, not Thursday.", picked: weekend },
  { scene: "a later exclusion withdraws an earlier name",
    slots: three, text: "Both Saturday and Sunday except Sunday.", picked: [saturday.start] },
  { scene: "both follows the abbreviated offered days",
    slots: three, text: "Sat and Sun both, not Thursday.", picked: weekend },
  { scene: "an unpunctuated separate exclusion keeps the named pair",
    slots: three, text: "Sat and Sun both except Thursday.", picked: weekend },
  { scene: "a reported pair does not add a choice to the sender's own answer",
    slots: three, text: "Saturday works. Ana said, Sat and Sun both.", picked: [saturday.start] },
  { scene: "a trailing clock does not silently select mismatched times",
    slots: three, text: "Sat and Sun both at 11am.", picked: [],
    followUp: { text: "Sat and Sun both.", picked: weekend,
      unqualified: ["Both work.", "Ana said Saturday and Sunday both work.", "\"Saturday and Sunday both work.\"", "Ana said, the third works."] } },
  { scene: "an unavailable partly named pair needs clarification",
    slots: [thursday, friday, saturday], text: "Sat and Sun both.", picked: [] },
  { scene: "an unrelated refusal cannot complete one named choice",
    slots: three, text: "Both Saturday, not Thursday.", picked: [], generalPrelude: true,
    followUp: { text: "Sunday works.", picked: [sunday.start], restart: true } },
  { scene: "two aliases of one offered time do not name a pair",
    slots: three, text: "Both Saturday and the second time, not Thursday.", picked: [] },
  { scene: "either names offered times",
    slots: three, text: "Either Saturday or Sunday.", picked: weekend },
  { scene: "bare either accepts the whole offer",
    slots: three, text: "Either works.", picked: three.map(slot => slot.start) },
  { scene: "a trailing either keeps both abbreviated days",
    slots: three, text: "Sat and Sun either.", picked: weekend },
  { scene: "a trailing either keeps both named ordinals",
    slots: three, text: "The 2nd and 3rd either work.", picked: weekend },
  { scene: "a bare ordinal list without a joiner keeps both choices",
    slots: three, text: "The 2nd 3rd either work.", picked: weekend },
  { scene: "a bare three-item ordinal list keeps all three choices",
    slots: three, text: "The 1st 2nd 3rd either work.", picked: three.map(slot => slot.start) },
  { scene: "a bare ordinal refusal with a later pick books only the picked time",
    slots: three, text: "The 2nd 3rd don't work, Thursday works.", picked: [thursday.start] },
  { scene: "a plural are-good keeps both named ordinals",
    slots: three, text: "The 2nd and 3rd are good.", picked: weekend },
  { scene: "a trailing clock after either asks again",
    slots: three, text: "Sat and Sun either at 11am.", picked: [],
    followUp: { text: "Sat and Sun either.", picked: weekend } },
  { scene: "a reported pair after either does not add a choice to the sender's own answer",
    slots: three, text: "Saturday works. Ana said, Sat and Sun either.", picked: [saturday.start] },
  { scene: "a bare abbreviated day list keeps both days",
    slots: three, text: "Sat Sun.", picked: weekend },
  { scene: "a bare abbreviated day list keeps all three days",
    slots: three, text: "Sat Sun and Thu.", picked: three.map(slot => slot.start) },
  { scene: "a bare abbreviated day list in either order keeps both days",
    slots: three, text: "Sun Sat.", picked: weekend },
  { scene: "an abbreviated day before a full day name counts",
    slots: three, text: "Sat Sunday works.", picked: weekend },
  { scene: "a reported bare pair does not add a choice to the sender's own answer",
    slots: three, text: "Saturday works. Ana said, Sat Sun both.", picked: [saturday.start] },
  { scene: "a day named only inside a condition does not book",
    slots: three, text: "If Ana can't make Sunday, Saturday works.", picked: [] },
  { scene: "a day named only inside a condition before book it does not book",
    slots: three, text: "If Sunday works for Ana, book it", picked: [] },
  { scene: "a bare when clause keeps the picked day unbooked",
    slots: three, text: "Saturday works when Ana is free", picked: [] },
  { scene: "a leading when clause keeps the picked day unbooked",
    slots: three, text: "When Ana is free, Saturday works", picked: [] },
  { scene: "an unconditional pick still books when a later day is when-conditional",
    slots: three, text: "Saturday works. Sunday works when Ana is free", picked: [saturday.start] },
  { scene: "a conditional yes does not book every offered time",
    slots: three, text: "If Sunday works for Ana, yes", picked: [] },
  { scene: "a conditional day after an unconditional pick does not add a choice",
    slots: three, text: "Saturday works. If Ana can't make Sunday, Sunday works.", picked: [saturday.start] },
  { scene: "a conditional clause does not turn an unconditional pick into a refusal",
    slots: three, text: "Sunday works, unless Ana can't make it", picked: [] },
  { scene: "the later option works picks only the last offered time",
    slots: three, text: "The later option works.", picked: [sunday.start] },
  { scene: "the later time works picks only the last offered time",
    slots: three, text: "The later time works.", picked: [sunday.start] },
  { scene: "a bare later without a noun still asks again",
    slots: three, text: "Later works.", picked: [] },
  { scene: "a month and ordinal day answer asks again",
    slots: three, text: "October 17th works.", picked: [],
    followUp: { text: "Saturday works.", picked: [saturday.start] } },
  { scene: "a day before the month answer asks again",
    slots: three, text: "17 October works.", picked: [],
    followUp: { text: "Saturday works.", picked: [saturday.start] } },
  { scene: "a day-of-month answer asks again",
    slots: three, text: "The 17th works.", picked: [],
    followUp: { text: "Saturday the 17th works.", picked: [saturday.start] } },
  { scene: "a word day-of-month answer asks again",
    slots: three, text: "The twelfth works.", picked: [],
    followUp: { text: "Saturday works.", picked: [saturday.start] } },
  { scene: "a weekday with its matching date books that time",
    slots: three, text: "Thursday the 15th works.", picked: [thursday.start] },
  { scene: "a weekday with its matching date and clock books that time",
    slots: three, text: "Saturday the 17th at 11am works.", picked: [saturday.start] },
  { scene: "a yes with a weekday and matching date books that time",
    slots: three, text: "yes, Saturday the 17th", picked: [saturday.start] },
  { scene: "a date with its matching clock books that time",
    slots: three, text: "the 18th at 2pm works", picked: [sunday.start] },
  { scene: "a clock before may is not a date",
    slots: three, text: "Sunday at 2 may be best for me.", picked: [sunday.start] },
  { scene: "a single offered time with its matching date books that time",
    slots: [saturday], text: "Yes! See you on the 17th", picked: [saturday.start] },
  { scene: "a weekday before a comma and its matching date books that time",
    slots: three, text: "Saturday, the 17th works.", picked: [saturday.start] },
  { scene: "a date with its matching weekday in brackets books that time",
    slots: three, text: "The 17th (Saturday) works.", picked: [saturday.start] },
  { scene: "a comma weekday after a date-only re-ask books that time",
    slots: three, text: "The 17th works.", picked: [],
    followUp: { text: "Saturday, the 17th works.", picked: [saturday.start] } },
  { scene: "a bracketed weekday after a date-only re-ask books that time",
    slots: three, text: "The 17th works.", picked: [],
    followUp: { text: "The 17th (Saturday) works.", picked: [saturday.start] } },
  { scene: "a weekday on its matching date books that time",
    slots: three, text: "Saturday on the 17th works.", picked: [saturday.start] },
  { scene: "a weekday before a dash and its matching date books that time",
    slots: three, text: "Saturday - the 17th works.", picked: [saturday.start] },
  { scene: "a weekday before an en-dash and its matching date books that time",
    slots: three, text: "Saturday – the 17th works.", picked: [saturday.start] },
  { scene: "a weekday before a slash and its matching date books that time",
    slots: three, text: "Saturday/the 17th works.", picked: [saturday.start] },
  { scene: "a weekday before a semicolon and its matching date books that time",
    slots: three, text: "Saturday; the 17th works.", picked: [saturday.start] },
  { scene: "a weekday before a colon and its matching date books that time",
    slots: three, text: "Saturday: the 17th works.", picked: [saturday.start] },
  { scene: "a date on its matching weekday books that time",
    slots: three, text: "The 17th on Saturday works.", picked: [saturday.start] },
  { scene: "a weekday on its matching date after a date-only re-ask books that time",
    slots: three, text: "The 17th works.", picked: [],
    followUp: { text: "Saturday on the 17th works.", picked: [saturday.start] } },
  { scene: "a dash weekday after a date-only re-ask books that time",
    slots: three, text: "The 17th works.", picked: [],
    followUp: { text: "Saturday - the 17th works.", picked: [saturday.start] } },
  { scene: "a weekday with another offered date asks again",
    slots: three, text: "Saturday the 18th works.", picked: [] },
  { scene: "a date with another offered clock asks again",
    slots: three, text: "the 17th at 2pm works", picked: [] },
  { scene: "a weekday with a date in another month asks again",
    slots: three, text: "Saturday 17 November works.", picked: [] },
  { scene: "a weekday and date with another time's clock asks again",
    slots: three, text: "Saturday the 17th at 2pm works.", picked: [] },
  { scene: "another weekday with a date and its matching clock asks again",
    slots: three, text: "Sunday the 17th at 11am works.", picked: [] },
  { scene: "a late weekday with its matching date books that time",
    slots: [thursday, saturdayLate, sunday], text: "Saturday the 17th works.", picked: [saturdayLate.start] },
  { scene: "a reported day does not add a choice to the sender's own answer",
    slots: three, text: "Saturday works. Ana said, Sunday.", picked: [saturday.start] },
  { scene: "a reported day alone does not book any offered time",
    slots: three, text: "Ana said Sunday works.", picked: [] },
  { scene: "a reported broad choice alone does not book any offered time",
    slots: three, text: "Ana said both work.", picked: [] },
  { scene: "a reported ordinal alone does not book any offered time",
    slots: three, text: "Ana said the second works.", picked: [] },
  { scene: "a reported day before but does not take the sender's own choice",
    slots: three, text: "Ana said Sunday works, but Saturday works for me.", picked: [saturday.start] },
  { scene: "a quoted day alone does not book any offered time",
    slots: three, text: "\"Saturday works\"", picked: [] },
  { scene: "a day quoted after ok does not book any offered time",
    slots: three, text: "ok \"Saturday\" works", picked: [] },
  { scene: "a yes before a report accepts the whole offer",
    slots: three, text: "yes, Ana said hi", picked: three.map(slot => slot.start) },
  { scene: "a first-person want before a named day keeps the sender's own choice",
    slots: three, text: "I've wanted to go there forever, Saturday works", picked: [saturday.start] },
  { scene: "the verb sat does not add Saturday to a separate choice",
    slots: three, text: "Sunday works. I sat Sunday.", picked: [sunday.start] },
  { scene: "the verb sat does not add Saturday after a time clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Sunday works. I sat Sunday.", picked: [sunday.start] } },
  { scene: "an unavailable day in a spaced list leaves the offer open",
    slots: [thursday, friday, saturday], text: "Sat Sun.", picked: [] },
  { scene: "an ambiguous day in a spaced list leaves both clocks unselected",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Sat Sun.", picked: [] },
  { scene: "the noun sun does not add an extra day to a direct choice",
    slots: three, text: "Yeah, we can meet in the sun Saturday.", picked: [saturday.start] },
  { scene: "a joined abbreviated list keeps both choices before an affirmative phrase",
    slots: three, text: "Sat and Sun are good.", picked: weekend },
  { scene: "a joined abbreviated list keeps both choices with courtesy after clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Sat and Sun please.", picked: weekend } },
  { scene: "a joined list with an ambiguous named day must ask which precise times work",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Sat and Sun please.", picked: [],
    followUp: { text: "Sunday works.", picked: [sunday.start] } },
  { scene: "a missing day in a joined abbreviated list leaves the offer open",
    slots: [thursday, friday, saturday], text: "Sat and Sun are good.", picked: [] },
  { scene: "an explicit alternative preserves an offered day when another day is missing",
    slots: [thursday, friday, saturday], text: "Monday or Saturday works.", picked: [saturday.start] },
  { scene: "an explicit alternative with an ambiguous named day requires a time choice",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Sat or Sun are fine.", picked: [] },
  { scene: "a leading either keeps both abbreviated days",
    slots: three, text: "Either Sat Sun.", picked: weekend },
  { scene: "a leading either keeps all three abbreviated days",
    slots: three, text: "Either Sat Sun Thu.", picked: three.map(slot => slot.start) },
  { scene: "a leading both keeps both abbreviated days",
    slots: three, text: "Both Sat Sun.", picked: weekend },
  { scene: "a leading either before a refusal asks again",
    slots: three, text: "Either Sat Sun doesn't work.", picked: [],
    followUp: { text: "Sat Sun.", picked: weekend } },
  { scene: "a leading either with an ambiguous day asks again",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Either Sat Sun.", picked: [],
    followUp: { text: "Sunday works.", picked: [sunday.start] } },
  { scene: "a leading either with a missing day asks again",
    slots: [thursday, friday, saturday], text: "Either Sat Sun.", picked: [] },
  { scene: "a bare day list before a refusal keeps the other day",
    slots: three, text: "Sat Sun busy, Thu works.", picked: [thursday.start] },
  { scene: "a bare day list before a refusal asks again",
    slots: three, text: "Sat Sun no good.", picked: [],
    followUp: { text: "Thu works.", picked: [thursday.start], general: true } },
  { scene: "a trailing neither with a qualifier refuses the last named time beside a pick",
    slots: three, text: "Thursday works, Sunday neither for me", picked: [thursday.start] },
  { scene: "a trailing neither with an adverb refuses the last named time beside a pick",
    slots: three, text: "Thursday works, Sunday neither really works", picked: [thursday.start] },
  { scene: "a trailing neither with at all refuses the last named time beside a pick",
    slots: three, text: "Thursday works, Sunday neither at all", picked: [thursday.start] },
  { scene: "a yes that refuses one time with neither books the times not refused",
    slots: three, text: "Yes, Sunday neither works.", picked: [thursday.start, saturday.start] },
  { scene: "a yes that refuses two times with neither books the time not refused",
    slots: three, text: "Yes, Saturday and Sunday neither works.", picked: [thursday.start] },
  { scene: "a neither inside reported speech does not book the reported day",
    slots: three, text: "He said Sunday neither works for me", picked: [] },
  { scene: "a neither inside reported speech does not refuse a separate pick",
    slots: three, text: "He said Sunday neither works for me. Sunday works for me.", picked: [sunday.start] },
  { scene: "a neither inside a condition does not book the conditional clause",
    slots: three, text: "If Sunday neither works for me, Thursday works", picked: [] },
  { scene: "an ordinary first-turn yes accepts the whole offer",
    slots: three, text: "Yes.", picked: three.map(slot => slot.start) },
  { scene: "a plain yes after a new general clarification accepts the whole offer",
    slots: three, text: "Maybe.", picked: [],
    followUp: { text: "Yes.", picked: three.map(slot => slot.start), general: true } },
  { scene: "both selects two offered times after a time clarification",
    slots: [saturday, sunday], text: "Thursday works.", picked: [],
    followUp: { text: "Both of those work.", picked: weekend } },
  { scene: "explicit acceptance of all offered times resolves a time clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Any of those work.", picked: three.map(slot => slot.start) } },
  { scene: "an unrelated availability statement does not select a specific offered time",
    slots: [thursday, friday, saturday], text: "Monday works.", picked: [],
    followUp: { text: "Weekends work best. Saturday at 11am works.", picked: [saturday.start],
      unqualified: ["Weekends work best.", "Saturdays work best.", "I am usually free Saturday.", "Mornings work best.",
        "She can do Saturday 11am.", "Ana can do Saturday 11am.", "Saturday in two weeks works.", "Saturday after next works."] } },
  { scene: "a direct weekend preference still selects the offered weekend on a first reply",
    slots: [thursday, friday, saturday], text: "Weekends work best.", picked: [saturday.start] },
  { scene: "the named pair is the only availability",
    slots: three, text: "Either Saturday or Sunday only, no other times.", picked: weekend },
  { scene: "either named slot can be the single booking",
    slots: three, text: "Either Saturday or Sunday but not both.", picked: weekend },
  { scene: "both of the offered times are refused",
    slots: [saturday, sunday], text: "Yes, both of them don't work.", picked: [] },
  { scene: "a refusal alone does not book",
    slots: three, text: "Thursday doesn't work.", picked: [] },
  { scene: "a leading either with one abbreviated refusal does not book",
    slots: three, text: "Either Sat doesn't work.", picked: [] },
  { scene: "a leading both with one abbreviated refusal does not book",
    slots: three, text: "Both Sat doesn't work.", picked: [] },
  { scene: "a single abbreviated refusal with isn't good does not book",
    slots: three, text: "Either Sat isn't good.", picked: [] },
  { scene: "a trailing refusal applies to both full dayparts after time clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday morning and Sunday afternoon don't work for me, Thursday works.", picked: [thursday.start] } },
  { scene: "a compact list of abbreviated days refuses both days",
    slots: three, text: "Sat/Sun don't work for me, Thursday works.", picked: [thursday.start] },
  { scene: "both belongs to the refused time list instead of the separate choice",
    slots: three, text: "Thursday works, Saturday and Sunday both don't.", picked: [thursday.start] },
  { scene: "a broad yes with both named refusals does not pick an unnamed time",
    slots: three, text: "Yes, Saturday and Sunday both don't work.", picked: [] },
  { scene: "a broad yes with a negated remainder does not book it",
    slots: three, text: "Yes, Saturday and Sunday don't work, the rest don't work.", picked: [] },
  { scene: "a broad yes that affirms the remainder still books it",
    slots: three, text: "Yes, Saturday and Sunday don't work, the rest work.", picked: [thursday.start] },
  { scene: "a broad yes that affirms general availability still books the remainder",
    slots: three, text: "Yes, Saturday and Sunday don't work, I'm free.", picked: [thursday.start] },
  { scene: "saying two times are not booked does not refuse either time",
    slots: three, text: "Saturday and Sunday aren't booked and both work for me.", picked: weekend },
  { scene: "a favorable assessment keeps both named picks instead of an unnamed time",
    slots: three, text: "Saturday and Sunday aren't bad, so both work for me.", picked: weekend },
  { scene: "a complete clock refusal does not book an earlier joined clock",
    slots: three, text: "Saturday at 11am and Sunday at 2pm don't work for me.", picked: [] },
  { scene: "a schedule explanation leaves the earlier joined times refused",
    slots: three, text: "Saturday and Sunday don't work with my schedule. Thursday works.", picked: [thursday.start] },
  { scene: "a trailing qualifier does not revive a refused time",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday and Sunday don't work for me anymore. Thursday works.", picked: [thursday.start] } },
  { scene: "a time that does not fit the member's schedule stays refused",
    slots: three, text: "Saturday and Sunday don't fit my schedule. Thursday works.", picked: [thursday.start] },
  { scene: "a scheduling reason does not weaken the shared refusal after clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday and Sunday don't work for me due to work. Thursday works.", picked: [thursday.start] } },
  { scene: "a complete refusal of ordinal options leaves only the third choice",
    slots: three, text: "The first option and the second option don't work for me. The third works.", picked: [sunday.start] },
  { scene: "a time noun in a joined ordinal refusal leaves only the third choice",
    slots: three, text: "The first time and second aren't available. The third works.", picked: [sunday.start] },
  { scene: "a complete refusal of the first and second waits for a time",
    slots: three, text: "The first and second aren't available for me.", picked: [] },
  { scene: "an affirmative ordinal pair retains both precise positions",
    slots: three, text: "The first and second work for me.", picked: [thursday.start, saturday.start] },
  { scene: "an ordinal and a day can share a refusal without discarding the positive day",
    slots: three, text: "The first option and Sunday don't work for me. Saturday works.", picked: [saturday.start] },
  { scene: "a redundant daypart still identifies the exact refused clock",
    slots: three, text: "Saturday at 11am in the morning and Sunday at 2pm in the afternoon don't work for me.", picked: [] },
  { scene: "a refused exact clock does not remove a distinct clock in the same daypart",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Monday works.", picked: [],
    followUp: { text: "Saturday at 11am in the morning and Sunday at 2pm in the afternoon don't work. Saturday 10am works.",
      picked: [earlierSaturday.start] } },
  { scene: "a repeated clock keeps its trailing day and leaves a distinct clock available",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Monday works.", picked: [],
    followUp: { text: "11am in the morning on Saturday and 2pm in the afternoon on Sunday don't work. Saturday 10am works.",
      picked: [earlierSaturday.start] } },
  { scene: "a qualifier before the refusal verb does not book the refused time",
    slots: three, text: "Saturday for me doesn't work.", picked: [] },
  { scene: "a qualifier before a joined refusal does not book either joined time",
    slots: three, text: "Saturday and Sunday for me don't work.", picked: [] },
  { scene: "a qualifier before a joined refusal keeps a separate affirmative pick",
    slots: three, text: "Saturday and Sunday for me don't work, Thursday works.", picked: [thursday.start] },
  { scene: "a qualified refusal keeps an abbreviated day in the refused list",
    slots: three, text: "Thursday works. Saturday and Sun for me don't work.", picked: [thursday.start] },
  { scene: "a qualified refusal of an abbreviated day keeps a separate choice",
    slots: three, text: "Thursday works. Sat for me doesn't work.", picked: [thursday.start] },
  { scene: "a qualified named-time refusal keeps the opportunity open for another time",
    slots: three, text: "Saturday for me absolutely won't work.", picked: [],
    followUp: { text: "Thursday works.", picked: [thursday.start] } },
  { scene: "a separate acceptance survives a qualified won't-work statement",
    slots: three, text: "Saturday for me won't work. Thursday works.", picked: [thursday.start] },
  { scene: "a conditional refusal cannot award the named consequence",
    slots: three, text: "If Saturday for me won't work, Thursday works.", picked: [] },
  { scene: "an incomplete condition does not decline the opportunity",
    slots: three, text: "If Saturday for me won't work.", picked: [],
    followUp: { text: "Thursday works.", picked: [thursday.start], general: true } },
  { scene: "a reported refusal after a condition cannot decline the opportunity",
    slots: three, text: "If Saturday for me won't work. Ana said, no thanks.", picked: [] },
  { scene: "a conditional no in the same sentence keeps the offer open",
    slots: three, text: "If Saturday for me won't work, no thanks.", picked: [] },
  { scene: "a direct refusal after a condition can still decline the opportunity",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "If Saturday for me won't work. I don't want to meet.", picked: [] } },
  { scene: "a separate refusal declines the opportunity after a qualified time constraint",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday for me won't work. No thanks.", picked: [] } },
  { scene: "a qualifier before a joined plural refusal does not book either joined time",
    slots: three, text: "Saturday and Sunday for me aren't good.", picked: [] },
  { scene: "a qualifier before a clock refusal does not book the refused clock",
    slots: three, text: "Saturday at 11am for me doesn't work.", picked: [] },
  { scene: "a qualifier before a daypart refusal does not book the refused daypart",
    slots: three, text: "Saturday morning for me doesn't work.", picked: [] },
  { scene: "a qualifier before an ordinal refusal does not book the refused position",
    slots: three, text: "The first for me doesn't work.", picked: [] },
  { scene: "a qualifier before a joined ordinal refusal does not book either position",
    slots: three, text: "The first and second for me don't work.", picked: [] },
  { scene: "a vague later reference does not select the second position",
    slots: three, text: "The first and later works.", picked: [thursday.start] },
  { scene: "a qualified statement that a day is not a problem keeps its choice",
    slots: three, text: "Saturday is fine. Sunday for me isn't a problem.", picked: weekend },
  { scene: "a qualified statement that a day does not look good keeps the offer open",
    slots: three, text: "Saturday for me doesn't look good.", picked: [] },
  { scene: "a qualifier before a restated clock refusal does not book the refused clock",
    slots: three, text: "Saturday at 11am in the morning for me doesn't work.", picked: [] },
  { scene: "a qualifier before a joined restated clock refusal does not book either clock",
    slots: three, text: "Saturday at 11am in the morning and Sunday at 2pm in the afternoon for me don't work.", picked: [] },
  { scene: "a plural refusal verb does not book the refused time",
    slots: three, text: "Saturday aren't good.", picked: [] },
  { scene: "none of those work records unavailability after a time clarification",
    slots: three, text: "Both Saturday, not Thursday.", picked: [],
    followUp: { text: "None of those work.", picked: [], closeReason: "no common time" } },
  { scene: "an outright decline still closes a probe after a time clarification",
    slots: three, text: "Both Saturday, not Thursday.", picked: [],
    followUp: { text: "No.", picked: [] } },
  { scene: "a stored legacy clarification still needs an explicit time choice",
    slots: three, text: "Yes.", picked: [], legacyClarification: true,
    followUp: { text: "Sunday works.", picked: [sunday.start] } },
];

// spec/probeReply.md, "A model reading cannot replace a definite or qualified answer"
test.skipIf(!pgAvailable).each(scenarios)("a signed probe books only accepted offered times when $scene", async ({ slots, text, picked, followUp, legacyClarification, generalPrelude }) => {
  const url = await migratedDb("probe_offered_slots");
  const clock = new SimClock(Date.UTC(2026, 9, 12, 16));
  const app = APPS.friends;
  const networkId = "friends:nyc";
  const secret = "synthetic-probe-offered-slots-test-secret";
  let service: NetworkService | undefined;
  let server: Awaited<ReturnType<typeof serveHttp>> | undefined;
  const start = async () => {
    const current = new NetworkService({
      url, clock, photoStorage: null, networks: [{ id: networkId, matchingEnabled: false }],
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
      network: { seed: 1, plans: false, growth: false }, notify: false,
      log: () => {}, adapter: () => new DryRunAdapter(() => {}),
    });
    service = current;
    await current.start();
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => current.fetch(req) });
    return current;
  };
  const stop = async () => {
    await server?.stop(true);
    await service?.close();
  };
  try {
    const initial = await start();
    const runtime = () => service!.runtimes.get(networkId)!;
    const staff = { id: "fixture-staff", roles: ["safety" as const], grants: [{ role: "safety" as const, app: app.id }], via: "sso" as const };
    const recipients = [{ name: "Jo", e164: "+12125550431" }, { name: "Rae", e164: "+12125550432" }];
    const people = [];
    for (const { name, e164 } of recipients) {
      const joined = await initial.accounts.join(app, { e164, personId: null }, {
        firstName: name, age: 30, consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      for (const check of ["age", "liveness"] as const) {
        expect(await initial.verify(staff, runtime(), joined.membership.memberId, check, "pass", "fixture verification")).toEqual({ ok: true });
      }
      people.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint" });
    }
    const [first, second] = people.map(person => person.id) as [string, string];
    const fixture = new Mini(people, { app: app.id, plans: false, growth: false });
    fixture.clock.set(clock.now());
    await fixture.onboard(first, second);
    const now = clock.now();
    // Start from a delivered probe. The service currently emits up to three options, and the
    // four-option case restores an explicit offer to exercise the extra unmentioned time.
    const offered = slots.map((slot, i) => ({ ...slot, key: "abcd"[i]!, end: slot.start + 2 * HOUR }));
    const id = "fixture-probe-offered-slots";
    const opportunity: NetworkState["opps"][number] = {
      id, origin: "player", kind: "intro", category: "hobby", objective: "play chess over the board",
      detail: "", participants: [first, second], alternates: [], primed: [first],
      status: [[first, "available"], [second, "probing"]], explanations: {}, stage: "probing",
      review: { queuedAt: now - HOUR, deadline: now + DAY, decision: "approve", reviewer: "fixture-staff", decidedAt: now - HOUR },
      deadline: now + DAY, createdAt: now - HOUR, score: 0.5, generator: "fixture",
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
        interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      exploration: false, sameDay: false, contacted: [first, second], reminded: [], tags: [], replacements: 0, feedbackFrom: [],
      first, sentAt: { [first]: now - HOUR, [second]: now }, offered: { [first]: offered, [second]: offered },
      picks: { [first]: offered.map(slot => slot.start) },
    };
    await runtime().unitOfWork(net => net.importState({
      ...net.exportState(), opps: [opportunity], members: fixture.net.exportState().members.map(member =>
        member.id === second ? {
          ...member, awaiting: { kind: "probe", oppId: id, at: now, ...(legacyClarification ? { clarified: true } : {}) },
        } : member),
    }));
    const signed = async (messageId: string, text: string) => {
      clock.advance(MINUTE);
      const input: TurnRequest = { app: app.id, channel: "blooio", from: recipients[1]!.e164, to: null, text,
        messageId, transport: "imessage", receivedAt: clock.now() };
      const body = JSON.stringify(input);
      const signature = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body,
        nowS: Math.floor(clock.now() / 1000) });
      const response = await fetch(new URL(TURN_PATH, server!.url), {
        method: "POST", headers: { "content-type": "application/json", ...signature }, body,
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const savedOpportunity = async () => (await runtime().pg.load())?.opps.find(opp => opp.id === id);
    const booking = async () => {
      const saved = await savedOpportunity();
      return { stage: saved?.stage, picked: saved?.picks?.[second] ?? [], meetingAt: saved?.meetingAt };
    };
    const awaiting = async () => (await runtime().pg.load())?.members.find(member => member.id === second)?.awaiting;
    const clarifyGeneral = "Just to check: is that a yes or a no? Either is fine.";
    if (generalPrelude) {
      const general = await signed("probe-offered-slots-general", "Maybe.");
      expect(general).toMatchObject({ outcome: "handled", replies: [clarifyGeneral] });
      expect(await awaiting()).toMatchObject({ kind: "probe", oppId: id, timeChoice: false });
    }
    const reply = await signed("probe-offered-slots-answer", text);
    expect(await booking()).toEqual({
      stage: picked.length ? "scheduled" : "probing", picked, meetingAt: picked[0],
    });
    if (followUp) {
      const pendingChoice = { kind: "probe", oppId: id, timeChoice: !followUp.general };
      const waiting = { stage: "probing", picked: [], meetingAt: undefined };
      expect(reply).toMatchObject({ outcome: "handled", replies: [followUp.general ? clarifyGeneral : clarifyTime] });
      expect(await awaiting()).toMatchObject(pendingChoice);
      if (followUp.restart) {
        await stop();
        await start();
        expect(await awaiting()).toMatchObject(pendingChoice);
      }
      if (!followUp.general) {
        for (const [index, unqualified] of ["Yes.", ...followUp.unqualified ?? []].entries()) {
          await signed(`probe-offered-slots-unqualified-${index}`, unqualified);
          expect(await booking()).toEqual(waiting);
          expect(await awaiting()).toMatchObject(pendingChoice);
        }
      }
      await signed("probe-offered-slots-follow-up", followUp.text);
      expect(await booking()).toEqual({
        stage: followUp.picked.length ? "scheduled" : "closed",
        picked: followUp.picked, meetingAt: followUp.picked[0],
      });
      if (followUp.closeReason) {
        const saved = await savedOpportunity();
        expect(saved?.closedReason).toBe(followUp.closeReason);
        expect(saved?.picks?.[second]).toEqual([]);
      }
    }
  } finally {
    await stop();
    await dropDb(url);
  }
}, 60_000);
