import { classifyYesNo, type MemberId } from "@thenetwork/core";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { photoAskAnswerFor, photoDraftReplyFor, photoOfferCooldownMs, type PhotoPick, type PhotoPickResult } from "../../core/src/generated/photoRelayItem.ts";
import { isValidTimeZone } from "../../blooio/src/quiet-hours.ts";
import type { AppId } from "../../platform/src/apps.ts";
import {
  firstNameOf, maskOf, PHOTO_RELAY_TIME_ZONE, PHOTO_SEND_NOTICE, photoSetSha,
  type DraftInput, type DraftPrompt, type DueNotice, type PhotoDraft, type PhotoHolding, type PhotoRelayService, type PreparedOffer,
} from "../../platform/src/photo-relay.ts";
import type { PhotoService } from "../../platform/src/photos.ts";
import type { PhotoHoldingsView } from "../../mcp/src/hooks.ts";
import { parseRelayRequest } from "../../engine/src/relay.ts";
import { RELAY_AMBIGUOUS_NAME } from "../src/relay.ts";
import { localDay, readPhotoMessage, type PhotoReading, type PhotoSlot, type ReaderDraft, type ReaderThread } from "./photoReference.ts";
import type { NetworkRuntime } from "./runtime.ts";

const LINK = "\u0000photo-check-link\u0000";
const PHOTO_LINK = /^\s*(?:new\s+)?photo\s+link[\s.!]*$/i;

export const PHOTO_RELAY_TEXT = {
  propose: (name: string, line: string, link: string, notice: string) => `Send ${name} photo ${line}? See it: ${link} ${notice} Reply YES to send it, or tell me which one.`,
  proposeSet: (name: string, k: number, lines: string, link: string, notice: string) => `Send ${name} these ${k}: ${lines}? See them: ${link} ${notice} Reply YES to send all ${k}, or tell me which ones.`,
  choose: (lines: string, link: string) => `Which one? ${lines}. See them: ${link} Reply with the number.`,
  list: (name: string, count: number, lines: string, link: string) => `Which photo should ${name} get? You have ${count}: ${lines}. See them: ${link} Reply with the number, or say something like "the beach one".`,
  noMatch: (count: number, lines: string, link: string) => `I don't see that one. You have ${count}: ${lines}. See them: ${link} Reply with the number.`,
  noMatchContent: (lines: string, link: string) => `I can't see what is in your photos. Pick a number, or name a photo, like "call photo 2 dog": ${lines}. See them: ${link}`,
  allShared: "That's all your photos. Text ADD PHOTOS to add more.",
  alreadyShared: (name: string, n: number, lines: string) => `${name} already has photo ${n}. Which other one? ${lines}`,
  tooMany: (lines: string, link: string) => `I can send up to 3 at a time. Which ones? ${lines}. See them: ${link}`,
  ownOnly: (lines: string) => `I can only send your own photos. Which of yours? ${lines}`,
  noCodes: (lines: string) => `I don't use photo codes or links. Tell me which photo in your own words, like "the second one": ${lines}`,
  notByLooks: (lines: string) => `I don't pick photos by looks. Which one? ${lines}`,
  whichMatch: (names: string[]) => `Who should get it? ${names.join(" or ")}. Say something like "send ${names[0]} the beach one".`,
  noMatchOpen: "You have no open chat with a match to send a photo to.",
  addFirst: "You have no photos with me yet. Text ADD PHOTOS and I will send you a private link to add them.",
  unavailable: "I can't send photos here.",
  changed: "Your photos changed since I asked.",
  whichOne: (lines: string) => `Which one? Reply with the number: ${lines}`,
  cancelled: "Okay, I won't send it.",
  asking: (name: string) => `Okay. I'll ask ${name} if they want it. An automatic check screens it first. I'll tell you if it doesn't go.`,
  waitForAnswer: (name: string) => `${name} hasn't answered your last photo yet. You can offer another after that.`,
  coolingDown: (name: string, when: string) => `You can offer ${name} another photo after ${when}.`,
  photosOff: "Photos are off for this chat. You can still send messages.",
  dailyLimit: "That's the most photos for today. Try again tomorrow.",
  lapsed: "That choice timed out, so I sent nothing. Tell me which photo again.",
  sent: (name: string) => `Your photo is on its way to ${name}. I can't tell you if they open it.`,
  notTaken: (name: string) => `${name} didn't take your photo, so it stays with you.`,
  notApproved: "Our safety team didn't approve that photo, so I didn't send it.",
  checkTimedOut: "The safety team could not check your photo in time, so I didn't send it. You can choose it again.",
  withdrawn: "Okay, I won't send your photo.",
  withdrawnViewing: (name: string) => `Done. ${name} can't open it again, but I can't undo what they already saw.`,
  noneToWithdraw: "No photo of yours is waiting to go to this match.",
  takeBackWhich: (names: string[]) => `Which match? ${names.join(" or ")}. Say something like "take back the photo from ${names[0]}".`,
  alsoText: " I only send the photo here. Send your message on its own.",
  holdings: (count: number, lines: string, link: string, domain: string) =>
    `You have ${count === 1 ? "1 photo" : `${count} photos`} with me: ${lines}. See them: ${link} Agents only see this list if you allow it at ${domain}/oauth/consents, never the photos. Say "call photo 2 beach" to name one, "take back photo 2" to stop sharing it, or "delete photo 2".`,
  holdingsForAgent: (count: number, lines: string, domain: string) =>
    `You have ${count === 1 ? "1 photo" : `${count} photos`} with me: ${lines}. Agents only see this list if you allow it at ${domain}/oauth/consents, never the photos. Say "call photo 2 beach" to name one, "take back photo 2" to stop sharing it, or "delete photo 2".`,
  holdingsNone: (name: string) => `${name} has none of your photos.`,
  named: (n: number, label: string) => `Done. Photo ${n} is now "${label}".`,
  nameFormat: `Use 1 to 3 words with letters or numbers, like "call photo 2 beach".`,
  nameTaken: (m: number, label: string) => `Photo ${m} is already called "${label}". Pick another name.`,
  nameLooks: "I can't use that name. Pick another.",
  nameWhich: `Which photo? Say something like "call photo 2 beach".`,
  deleteAsk: (line: string) => `Delete photo ${line}? You can't undo this, and anyone waiting for it won't get it. Reply YES to delete it.`,
  deleteAskSet: (lines: string) => `Delete photos ${lines}? You can't undo this, and anyone waiting for them won't get them. Reply YES to delete them.`,
  deleted: (lines: string) => `Deleted. Your other photos are numbered again: ${lines}`,
  deletedAll: "Deleted. You have no other photos with me.",
  noneToDelete: "You have no photos with me.",
  connector: "I texted you the photo to check. Reply YES to that text to send it.",
  connectorSay: `Pass the person's own words about which photo to send and to whom, like "send Maya the beach one".`,
  sayWhich: `Tell me which photo to send and to whom, like "send Maya the beach one".`,
  ask: (name: string, k: number) => `${name} wants to send you ${k === 1 ? "a photo" : `${k} photos`}. An automatic check screens every photo first. Want it? Reply YES or NO. If you say no, ${name} isn't told why.`,
  askFirst: " Say NO MORE PHOTOS any time and I won't offer you photos again.",
  taking: "Okay. I'll text you a private link after the check.",
  declined: (name: string) => `Okay, I won't show it. ${name} isn't told why.`,
  never: "Done. I won't offer you photos from matches. Say PHOTOS OK to change that.",
  photosOk: "Okay. Matches can offer you photos again, and I'll ask you each time.",
  askGone: "This photo is no longer available.",
  ready: (name: string, k: number, link: string) => `${k === 1 ? `${name}'s photo is ready` : `${name}'s ${k} photos are ready`}: ${link} It opens only on the first phone you open it on, until ${name} takes it back. Text PHOTO LINK for a new link. Reply REPORT if it's not okay.`,
  newViewLink: (name: string, link: string) => `Here is a new private link for ${name}'s photo: ${link} The old link no longer opens.`,
  newViewLinks: (links: [string, string][]) => `Here are new private links: ${links.map(([name, link]) => `${name}: ${link}`).join("; ")}. The old links no longer open.`,
  noViewLink: "No photo is waiting for you to open.",
  notReady: (name: string) => `${name}'s photo didn't come through, so there's nothing to open.`,
  reported: "Thanks for telling me. I closed the photo, and the safety team will look at it.",
  closed: "Thanks for telling me. I closed the photo.",
} as const;

interface PhotoRelayFlowDeps {
  sql: SQL;
  relay: PhotoRelayService;
  photos: Pick<PhotoService, "rows" | "remove" | "mayTake">;
  now: () => number;
  log: (line: string) => void;
  phoneKey: (e164: string) => string;
  reply: (rt: NetworkRuntime, e164: string, text: string, key: string) => Promise<void>;
  runtimeOfMember: (app: AppId, memberId: string) => Promise<NetworkRuntime | undefined>;
  parties: (input: { app: AppId; threadId: string; senderPersonId: string }) => Promise<object | undefined>;
  domain: (app: AppId) => string;
}

export type PhotoRequestStatus = "texted" | "done" | "refused" | "unavailable";
export interface PhotoRelayAnswer { status: PhotoRequestStatus | "blocked"; text: string }
export type PhotoRelayFinish = (tx: SQL) => Promise<(answer: PhotoRelayAnswer) => Promise<void>>;
type TextCommit = (tx: SQL) => Promise<(text: string) => Promise<void>>;
type PhotoCheckAnswer = { state: "offered" | "changed" | "lapsed" | "refused"; text: string };

interface Who { rt: NetworkRuntime; app: AppId; personId: string; memberId: string }
interface Scene {
  at: number; zone: string; slots: PhotoSlot[]; threads: ReaderThread[]; draft: PhotoDraft | undefined;
  reading: PhotoReading; setSha: string;
}
type DraftShape = Omit<DraftInput, "personId" | "app" | "prompt">;
interface Spoken { text: string; draft?: DraftShape; link?: true; unavailable?: true; asked?: true }
const UNAVAILABLE: Spoken = { text: PHOTO_RELAY_TEXT.unavailable, unavailable: true };
type Committed = Awaited<ReturnType<PreparedOffer["commit"]>>;
class PhotoAskWithdrawn extends Error { constructor() { super("photo_ask_withdrawn"); this.name = "PhotoAskWithdrawn"; } }
class PhotoOfferNotReportable extends Error { constructor() { super("photo_offer_not_reportable"); this.name = "PhotoOfferNotReportable"; } }
const askKey = (requestKey: string) => `photo-ask:${requestKey}`;

function dayWords(at: number, now: number, zone: string): string {
  const gap = localDay(now, zone).n - localDay(at, zone).n;
  if (gap === 0) return "today";
  if (gap === 1) return "yesterday";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).formatToParts(at);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

function timeWords(at: number, zone: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(/\s/gu, " ");
  return `${weekday} ${time}`;
}

const inboundRowOf = (rowId: string) => `msg:${rowId.replace(/^in:/, "")}`;

export class PhotoRelayFlow {
  constructor(private readonly d: PhotoRelayFlowDeps) {}

  async turn(input: { rt: NetworkRuntime; e164: string; memberId: string; personId: string | undefined; text: string; rowId: string }): Promise<boolean> {
    let heard = false;
    const hear = async () => { if (!heard) { heard = true; await input.rt.unitOfWork(net => net.photoMemberHeard(input.memberId as MemberId)); } };
    const handled = await this.handleTurn(input, hear);
    if (handled) await hear();
    return handled;
  }

  private async handleTurn(input: { rt: NetworkRuntime; e164: string; memberId: string; personId: string | undefined; text: string; rowId: string }, hear: () => Promise<void>): Promise<boolean> {
    const { rt, e164, memberId, personId, text, rowId } = input;
    if (!personId) return false;
    const who: Who = { rt, app: rt.app.id, personId, memberId };
    const scene = await this.scene(who, text, null);
    const key = `photo-relay:${rowId}`;
    const prompt: DraftPrompt = { via: "turn", inboundId: rowId, key };
    const say = (body: string) => this.d.reply(rt, e164, body, key);
    const reading = scene.reading;

    if (reading.kind === "photos_ok" || reading.kind === "no_more_photos") {
      const never = reading.kind === "no_more_photos";
      await this.d.sql.begin(tx => this.d.relay.setNever(tx, personId, who.app, never));
      await say(never ? PHOTO_RELAY_TEXT.never : PHOTO_RELAY_TEXT.photosOk);
      return true;
    }
    const reported = /^\s*report[\s.!]*$/i.test(text) ? await this.readyOfferPrompted(who, e164, rowId, scene.draft) : undefined;
    if (reported) {
      const done = await this.report(personId, who.app, reported, false);
      await say(!done ? PHOTO_RELAY_TEXT.askGone : done.filed ? PHOTO_RELAY_TEXT.reported : PHOTO_RELAY_TEXT.closed);
      return true;
    }
    if (PHOTO_LINK.test(text)) {
      const renewed = await this.d.relay.renewViewLinks(personId, who.app);
      const names = await Promise.all(renewed.map(r => this.d.relay.firstName(who.app, r.senderMemberId)));
      await say(!renewed.length ? PHOTO_RELAY_TEXT.noViewLink : renewed.length === 1 ? PHOTO_RELAY_TEXT.newViewLink(names[0]!, renewed[0]!.link)
        : PHOTO_RELAY_TEXT.newViewLinks(renewed.map((r, i): [string, string] => [names[i]!, r.link])));
      return true;
    }
    const [ask] = await this.d.relay.asksFor(personId, who.app);
    if (ask) {
      const answer = classifyYesNo(text);
      const newest = await this.askIsNewest(who, e164, rowId, ask.offerId, scene.draft);
      const choice = photoAskAnswerFor(newest, true, answer === "yes", answer === "no", false);
      if (choice === "ReceiverTakes" || choice === "ReceiverDeclines") {
        const taken = choice === "ReceiverTakes";
        await hear();
        const done = await this.d.sql.begin(tx => this.d.relay.answer(tx, ask.offerId, personId, taken ? "yes" : "no"));
        await say(done.outcome === "taken" ? PHOTO_RELAY_TEXT.taking : done.outcome === "declined" ? PHOTO_RELAY_TEXT.declined(ask.firstName) : PHOTO_RELAY_TEXT.askGone);
        if (done.outcome === "taken") await this.screenOffer(who.app, ask.offerId);
        return true;
      }
    }

    if (reading.kind === "draft" && scene.draft) {
      const draft = scene.draft;
      const newest = await this.draftIsNewest(who, e164, rowId, draft);
      const reply = photoDraftReplyFor(newest, draft.shownAt, scene.at, reading.hasReference, reading.yes, reading.no,
        draft.proposedIds.length > 0, draft.policyVersion === PHOTO_SEND_NOTICE.version, draft.photoSetSha === scene.setSha);
      switch (reply) {
        case "NotForTheDraft": return false;
        case "DraftLapsed":
          await this.d.sql.begin(tx => this.d.relay.dropDraft(tx, personId, who.app));
          await say(PHOTO_RELAY_TEXT.lapsed);
          return true;
        case "CancelDraft":
          await this.d.sql.begin(tx => this.d.relay.dropDraft(tx, personId, who.app));
          await say(PHOTO_RELAY_TEXT.cancelled);
          return true;
        case "AskWhichOne":
          await say(PHOTO_RELAY_TEXT.whichOne(this.lines(scene, this.slotsOf(scene, draft.shownIds), draft.recipientMemberId)));
          return true;
        case "ChangeProposal":
          await say(await this.speak(who, await this.redraft(who, scene, draft, reading.result, reading.wantsSet), prompt));
          return true;
        case "PhotosChanged":
          await say(`${PHOTO_RELAY_TEXT.changed} ${await this.speak(who, await this.rechosen(who, scene, draft), prompt)}`);
          return true;
        case "ConsentGiven":
          await say((await this.consented(who, scene, draft)).text);
          return true;
        default: { const _exhaustive: never = reply; return _exhaustive; }
      }
    }

    const spoken = await this.answerReading(who, scene);
    if (!spoken || (reading.kind === "take_back" && parseRelayRequest(text).kind === "contact_share")) return false;
    await say(await this.speak(who, spoken, prompt));
    return true;
  }

  async relay(input: { app: AppId; personId: string; memberId: string; text: string; threadId: string | null; inboundId: string; photoAsked: boolean; finish: PhotoRelayFinish }): Promise<PhotoRelayAnswer | undefined> {
    let finished = false;
    const commit = (status: PhotoRequestStatus): TextCommit => async tx => {
      const done = await input.finish(tx);
      return async text => { await done({ status, text }); finished = true; };
    };
    const settle = async (answer: PhotoRelayAnswer): Promise<PhotoRelayAnswer> => {
      if (!finished) await this.d.sql.begin(async tx => (await input.finish(tx))(answer));
      return answer;
    };
    const rt = await this.d.runtimeOfMember(input.app, input.memberId);
    if (!rt) return input.photoAsked ? settle({ status: "unavailable", text: PHOTO_RELAY_TEXT.unavailable }) : undefined;
    const who: Who = { rt, app: input.app, personId: input.personId, memberId: input.memberId };
    const scene = await this.scene(who, input.text, input.threadId);
    if (scene.reading.kind === "ambiguous_match") return settle({ status: "blocked", text: RELAY_AMBIGUOUS_NAME });
    const spoken = scene.reading.kind === "send" || scene.reading.kind === "take_back" ? await this.answerReading(who, scene, commit("done")) : undefined;
    if (!spoken) return input.photoAsked ? settle({ status: "refused", text: PHOTO_RELAY_TEXT.sayWhich }) : undefined;
    const status: PhotoRequestStatus = spoken.unavailable ? "unavailable" : spoken.draft ? "texted" : scene.reading.kind === "take_back" && !spoken.asked ? "done" : "refused";
    const text = await this.speak(who, spoken, { via: "turn", inboundId: input.inboundId, key: `relay:${input.inboundId}` }, commit(status));
    return settle({ status, text });
  }

  async connector(input: { app: AppId; personId: string; memberId: string; words: string }): Promise<{ status: PhotoRequestStatus; text: string }> {
    const rt = await this.d.runtimeOfMember(input.app, input.memberId);
    if (!rt || !this.d.relay.enabled) return { status: "unavailable", text: PHOTO_RELAY_TEXT.unavailable };
    const who: Who = { rt, app: input.app, personId: input.personId, memberId: input.memberId };
    const scene = await this.scene(who, input.words, null);
    if (scene.reading.kind === "ambiguous_match") return { status: "refused", text: RELAY_AMBIGUOUS_NAME };
    const spoken = scene.reading.kind === "send" || scene.reading.kind === "take_back" ? await this.answerReading(who, scene) : undefined;
    if (!spoken) return { status: "refused", text: PHOTO_RELAY_TEXT.connectorSay };
    if (!spoken.draft) return { status: spoken.unavailable ? "unavailable" : scene.reading.kind === "take_back" && !spoken.asked ? "done" : "refused", text: spoken.text };
    const saved = await this.d.sql.begin(tx => this.d.relay.saveDraft(tx, { ...spoken.draft!, personId: input.personId, app: input.app, prompt: { via: "send" } }));
    const body = spoken.link && saved.link ? spoken.text.replaceAll(LINK, saved.link) : spoken.text;
    const sent = await rt.unitOfWork(net => net.photoNotice(input.memberId as MemberId, saved.promptKey, body, "info", undefined, spoken.link && saved.link ? saved.link : undefined));
    return sent ? { status: "texted", text: PHOTO_RELAY_TEXT.connector } : { status: "unavailable", text: PHOTO_RELAY_TEXT.unavailable };
  }

  async holdings(personId: string, app: AppId, memberId: string): Promise<PhotoHoldingsView> {
    const rt = await this.d.runtimeOfMember(app, memberId);
    if (!this.d.relay.enabled || (await this.d.photos.mayTake(personId, app))) return { text: PHOTO_RELAY_TEXT.unavailable, photos: [] };
    const zone = rt ? await this.zoneOf(rt, memberId) : PHOTO_RELAY_TIME_ZONE;
    const held = await this.d.relay.holdings(personId, app, zone);
    const at = this.d.now();
    const lines = held.map(h => this.holdingLine(h, at, zone)).join("; ");
    return {
      text: held.length ? PHOTO_RELAY_TEXT.holdingsForAgent(held.length, lines, this.d.domain(app)) : PHOTO_RELAY_TEXT.addFirst,
      photos: held.map(h => ({ number: h.n, name: h.label, addedOn: h.addedOn, sharedWith: h.access.map(({ firstName, state }) => ({ firstName, state })) })),
    };
  }

  async consent(personId: string, app: AppId, draftId: string, revision: number, memberId: string): Promise<PhotoCheckAnswer> {
    const rt = await this.d.runtimeOfMember(app, memberId);
    if (!rt || !this.d.relay.enabled) return { state: "refused", text: PHOTO_RELAY_TEXT.unavailable };
    const who: Who = { rt, app, personId, memberId };
    const scene = await this.scene(who, "", null);
    const draft = scene.draft;
    if (!draft || draft.id !== draftId || draft.revision !== revision || draft.purpose !== "send") return { state: "changed", text: PHOTO_RELAY_TEXT.changed };
    const reply = photoDraftReplyFor(true, draft.shownAt, scene.at, false, true, false,
      draft.proposedIds.length > 0, draft.policyVersion === PHOTO_SEND_NOTICE.version, draft.photoSetSha === scene.setSha);
    if (reply === "DraftLapsed") return { state: "lapsed", text: PHOTO_RELAY_TEXT.lapsed };
    if (reply === "PhotosChanged") return { state: "changed", text: PHOTO_RELAY_TEXT.changed };
    if (reply !== "ConsentGiven") return { state: "refused", text: PHOTO_RELAY_TEXT.whichOne(this.lines(scene, this.slotsOf(scene, draft.shownIds), draft.recipientMemberId)) };
    const given = await this.consented(who, scene, draft);
    return { state: given.offered ? "offered" : "refused", text: given.text };
  }

  async takeBack(personId: string, app: AppId, memberId: string, shareRef: string): Promise<{ state: "taken_back" | "nothing_open" }> {
    const rt = await this.d.runtimeOfMember(app, memberId);
    if (!rt) return { state: "nothing_open" };
    const threads = new Set((await this.threads(rt, memberId)).map(thread => thread.threadId));
    if (threads.size === 0) return { state: "nothing_open" };
    const taken = await this.d.sql.begin(tx => this.d.relay.withdrawShare(tx, app, personId, threads, shareRef));
    return { state: taken ? "taken_back" : "nothing_open" };
  }

  async report(recipientPersonId: string, app: AppId, offerId: string, textAfter = true): Promise<{ filed: boolean } | undefined> {
    const offer = await this.d.relay.offer(offerId);
    if (!offer || offer.app !== app) return undefined;
    const close = async (tx: SQL) => { if (!(await this.d.relay.report(tx, offerId, recipientPersonId))) throw new PhotoOfferNotReportable(); };
    const rt = await this.d.runtimeOfMember(app, offer.recipientMemberId);
    let filed = false;
    try {
      if (rt) filed = await rt.unitOfWork(net => {
        const reported = net.photoReport(offer.recipientMemberId as MemberId, offer.senderMemberId as MemberId, offer.threadId);
        if (textAfter) {
          net.photoReportAnswer(offer.recipientMemberId as MemberId, `photo-report:${offer.id}`, reported ? PHOTO_RELAY_TEXT.reported : PHOTO_RELAY_TEXT.closed);
        }
        rt.unit.completeAction = close;
        return reported;
      });
      else await this.d.sql.begin(close);
    } catch (e) {
      if (e instanceof PhotoOfferNotReportable) return undefined;
      throw e;
    }
    if (!filed) this.d.log(`[alert] photo relay ${app}: the report of ${offer.id} closed the photo, but no safety report was filed`);
    return { filed };
  }

  async settle(app: AppId, offerId: string): Promise<void> {
    const settled = await this.d.sql.begin(tx => this.d.relay.settle(tx, offerId));
    if (!settled?.changed) return;
    const rt = await this.d.runtimeOfMember(app, settled.recipientMemberId);
    if (!rt) return;
    const name = await this.d.relay.firstName(app, settled.senderMemberId);
    const to = settled.recipientMemberId as MemberId;
    if (settled.phase === "ready") {
      const sent = !!settled.viewLink && await rt.unitOfWork(net => net.photoNotice(to, `photo-ready:${settled.offerId}`, PHOTO_RELAY_TEXT.ready(name, settled.count, settled.viewLink!), "relay", settled.threadId, settled.viewLink!));
      if (!sent) this.d.log(`[alert] photo relay ${app}: the view link of ${settled.offerId} was not sent`);
    } else if (settled.from === "reviewing" && (settled.phase === "rejected" || settled.phase === "check_timed_out")) {
      await rt.unitOfWork(net => net.photoNotice(to, `photo-not-ready:${settled.offerId}`, PHOTO_RELAY_TEXT.notReady(name), "relay", settled.threadId));
    }
  }

  async screenOffer(app: AppId, offerId: string): Promise<void> {
    const due = await this.d.relay.screensDue(app, offerId);
    await Promise.all(due.map(d => this.d.relay.screen(d.itemId)
      .catch(e => { this.d.log(`[photo-relay] the check of ${d.itemId} on ${app} waits for the next tick: ${(e as Error).message}`); return undefined; })));
    await this.settle(app, offerId).catch(e => this.d.log(`[photo-relay] offer ${offerId} on ${app} waits for the next tick: ${(e as Error).message}`));
  }

  async tick(app: AppId): Promise<{ expired: number }> {
    let expired = 0;
    for (const item of await this.d.relay.duePending(app)) {
      try {
        const rt = await this.d.runtimeOfMember(app, item.senderMemberId);
        const expire = async (tx: SQL) => { if (!(await this.d.relay.expire(item.id, tx))) throw new Error("Photo item changed before its expiry"); };
        if (rt) await rt.unitOfWork(net => { net.photoReviewExpired(item.id); rt.unit.completeAction = expire; });
        else await this.d.sql.begin(expire);
        expired++;
        if (item.offerId) await this.settle(app, item.offerId);
      } catch (e) {
        this.d.log(`[photo-relay] the expiry of ${item.id} on ${app} waits for the next tick: ${(e as Error).message}`);
      }
    }
    const screened = new Set<string>();
    for (const due of await this.d.relay.screensDue(app)) {
      if (!due.offerId || screened.has(due.offerId)) continue;
      screened.add(due.offerId);
      await this.screenOffer(app, due.offerId);
    }
    for (const offerId of await this.d.relay.due(app)) {
      await this.settle(app, offerId).catch(e => this.d.log(`[photo-relay] offer ${offerId} on ${app} waits for the next tick: ${(e as Error).message}`));
    }
    for (const due of await this.d.relay.notices(app)) {
      await this.notify(app, due).catch(e => this.d.log(`[photo-relay] the notice of ${due.offerId} on ${app} waits for the next tick: ${(e as Error).message}`));
    }
    await this.d.relay.purge(app);
    return { expired };
  }

  private async notify(app: AppId, due: DueNotice): Promise<void> {
    const rt = await this.d.runtimeOfMember(app, due.senderMemberId);
    const text = due.notice === "TellSent" ? PHOTO_RELAY_TEXT.sent(due.firstName)
      : due.notice === "TellNotTaken" ? PHOTO_RELAY_TEXT.notTaken(due.firstName)
      : due.notice === "TellNotApproved" ? PHOTO_RELAY_TEXT.notApproved : PHOTO_RELAY_TEXT.checkTimedOut;
    const done = async (tx: SQL) => { if (!(await this.d.relay.noticeSent(tx, due.offerId))) throw new Error("Photo notice changed before it was sent"); };
    if (!rt) { await this.d.sql.begin(done); return; }
    await rt.unitOfWork(net => {
      net.photoNotice(due.senderMemberId as MemberId, `photo-notice:${due.offerId}`, text, "info");
      rt.unit.completeAction = done;
    });
  }

  private async scene(who: Who, text: string, currentThreadId: string | null): Promise<Scene> {
    const at = this.d.now();
    const [zone, listed, threads, draft, rows] = await Promise.all([
      this.zoneOf(who.rt, who.memberId), this.d.relay.slots(who.personId, who.app), this.threads(who.rt, who.memberId),
      this.d.relay.draftOf(who.personId, who.app), this.d.photos.rows(who.personId, who.app),
    ]);
    const slots = listed.map(s => ({ ...s, sharedWith: s.heldBy }));
    const readerDraft = draft ? this.readerDraft(draft, slots) : null;
    const reading = readPhotoMessage(text, { photos: slots, now: at, timeZone: zone, threads, currentThreadId, draft: readerDraft });
    return { at, zone, slots, threads, draft, reading, setSha: photoSetSha(rows) };
  }

  private readerDraft(draft: PhotoDraft, slots: PhotoSlot[]): ReaderDraft {
    const numbers = (ids: string[]) => ids.map(id => slots.find(s => s.id === id)?.n).filter((n): n is number => n !== undefined);
    return { recipientMemberId: draft.recipientMemberId, shown: numbers(draft.shownIds), proposed: numbers(draft.proposedIds), wantsSet: draft.wantsSet, listed: draft.listed };
  }

  private async answerReading(who: Who, scene: Scene, commit?: TextCommit): Promise<Spoken | undefined> {
    const r = scene.reading;
    switch (r.kind) {
      case "ambiguous_match": return { text: RELAY_AMBIGUOUS_NAME };
      case "send": {
        if (r.target.kind === "ask") return { text: scene.threads.length ? PHOTO_RELAY_TEXT.whichMatch(scene.threads.map(t => t.firstName)) : PHOTO_RELAY_TEXT.noMatchOpen };
        const thread = r.target.thread;
        if (!(await this.partiesOk(who, thread.threadId))) return UNAVAILABLE;
        const spoken = this.pickText(scene, "send", thread, r.result, r.wantsSet);
        return r.alsoText ? { ...spoken, text: `${spoken.text}${PHOTO_RELAY_TEXT.alsoText}` } : spoken;
      }
      case "holdings": {
        if (!this.d.relay.enabled || (await this.d.photos.mayTake(who.personId, who.app))) return UNAVAILABLE;
        const held = await this.d.relay.holdings(who.personId, who.app, scene.zone);
        if (!held.length) return { text: PHOTO_RELAY_TEXT.addFirst };
        const name = r.firstName === null ? null : firstNameOf(r.firstName);
        const shown = name === null ? held : held.filter(h => h.access.some(a => a.firstName.toLowerCase() === name.toLowerCase()));
        if (!shown.length) return { text: PHOTO_RELAY_TEXT.holdingsNone(name ?? firstNameOf("")) };
        const lines = shown.map(h => this.holdingLine(h, scene.at, scene.zone)).join("; ");
        const link = await this.d.relay.mineLink(who.personId, who.app);
        return { text: link ? PHOTO_RELAY_TEXT.holdings(shown.length, lines, link, this.d.domain(who.app)) : PHOTO_RELAY_TEXT.holdingsForAgent(shown.length, lines, this.d.domain(who.app)) };
      }
      case "name": {
        const named = await this.d.relay.label(who.personId, who.app, r.n, r.label);
        if (named === "ok") return { text: PHOTO_RELAY_TEXT.named(r.n, r.label.toLowerCase()) };
        if (named === "taken") return { text: this.takenText(scene, r.label) };
        return { text: named === "invalid" ? PHOTO_RELAY_TEXT.nameFormat : PHOTO_RELAY_TEXT.nameWhich };
      }
      case "name_refused":
        return { text: r.reason === "format" ? PHOTO_RELAY_TEXT.nameFormat : r.reason === "looks" ? PHOTO_RELAY_TEXT.nameLooks
          : r.reason === "which" ? PHOTO_RELAY_TEXT.nameWhich : this.takenText(scene, null) };
      case "delete": return this.pickText(scene, "delete", null, r.result, false);
      case "take_back": return this.withdraw(who, scene, r.threadId, r.numbers, commit);
      case "draft": case "none": case "photos_ok": case "no_more_photos": return undefined;
      default: { const _exhaustive: never = r; return _exhaustive; }
    }
  }

  private takenText(scene: Scene, label: string | null): string {
    const wanted = label ?? (scene.reading.kind === "name" ? scene.reading.label : null);
    const owner = wanted === null ? undefined : scene.slots.find(s => (s.label ?? "").toLowerCase() === wanted.toLowerCase());
    return owner?.label ? PHOTO_RELAY_TEXT.nameTaken(owner.n, owner.label) : PHOTO_RELAY_TEXT.nameLooks;
  }

  private pickText(scene: Scene, purpose: "send" | "delete", thread: ReaderThread | null, result: PhotoPickResult, wantsSet: boolean): Spoken {
    const chosen = scene.slots.filter(s => (result.chosen & (1 << (s.n - 1))) !== 0);
    const all = scene.slots;
    const to = thread?.recipientMemberId ?? null;
    const name = thread?.firstName ?? "";
    const lines = (list: PhotoSlot[]) => this.lines(scene, list, to);
    const draft = (shown: PhotoSlot[], proposed: PhotoSlot[], listed: boolean): DraftShape => ({
      purpose, threadId: thread?.threadId ?? null, recipientMemberId: to,
      shownIds: shown.map(s => s.id), proposedIds: proposed.map(s => s.id), wantsSet, listed,
    });
    const offered = (list: PhotoSlot[], text: (lines: string) => string): Spoken => {
      const shown = list.length ? list : all;
      return { text: text(lines(shown)), draft: draft(shown, [], false) };
    };
    const pick: PhotoPick = result.pick;
    if (purpose === "delete") {
      if (!all.length) return { text: PHOTO_RELAY_TEXT.noneToDelete };
      if (pick === "ProposePhotos") return { text: chosen.length === 1 ? PHOTO_RELAY_TEXT.deleteAsk(lines(chosen)) : PHOTO_RELAY_TEXT.deleteAskSet(lines(chosen)), draft: draft(chosen, chosen, false) };
      const shown = chosen.length ? chosen : all;
      return { text: PHOTO_RELAY_TEXT.whichOne(lines(shown)), draft: draft(shown, [], true) };
    }
    const notice = PHOTO_SEND_NOTICE.text.replaceAll("{{recipient}}", name);
    switch (pick) {
      case "ProposePhotos":
        return chosen.length === 1
          ? { text: PHOTO_RELAY_TEXT.propose(name, lines(chosen), LINK, notice), draft: draft(chosen, chosen, false), link: true }
          : { text: PHOTO_RELAY_TEXT.proposeSet(name, chosen.length, lines(chosen), LINK, notice), draft: draft(chosen, chosen, false), link: true };
      case "ChoosePhotos": return { text: PHOTO_RELAY_TEXT.choose(lines(chosen), LINK), draft: draft(chosen, [], true), link: true };
      case "ListPhotos": {
        const shown = chosen.length ? chosen : all;
        return { text: PHOTO_RELAY_TEXT.list(name, all.length, lines(shown), LINK), draft: draft(shown, [], false), link: true };
      }
      case "NoMatchingPhoto":
        if (!chosen.length) return { text: PHOTO_RELAY_TEXT.allShared };
        return scene.reading.kind === "send" && scene.reading.why === "content"
          ? { text: PHOTO_RELAY_TEXT.noMatchContent(lines(chosen), LINK), draft: draft(chosen, [], false), link: true }
          : { text: PHOTO_RELAY_TEXT.noMatch(all.length, lines(chosen), LINK), draft: draft(chosen, [], false), link: true };
      case "AlreadyShared": {
        const others = all.filter(s => !chosen.includes(s) && !(to !== null && s.sharedWith.includes(to)));
        if (!others.length) return { text: PHOTO_RELAY_TEXT.allShared };
        return { text: PHOTO_RELAY_TEXT.alreadyShared(name, chosen[0]!.n, lines(others)), draft: draft(others, [], false) };
      }
      case "TooManyPhotos": return { text: PHOTO_RELAY_TEXT.tooMany(lines(chosen), LINK), draft: draft(chosen, [], false), link: true };
      case "OwnPhotosOnly": return offered(chosen, PHOTO_RELAY_TEXT.ownOnly);
      case "NoPhotoCodes": return offered(chosen, PHOTO_RELAY_TEXT.noCodes);
      case "NotByLooks": return offered(chosen, PHOTO_RELAY_TEXT.notByLooks);
      case "AskWhichMatch": return { text: scene.threads.length ? PHOTO_RELAY_TEXT.whichMatch(scene.threads.map(t => t.firstName)) : PHOTO_RELAY_TEXT.noMatchOpen };
      case "AddPhotosFirst": return { text: PHOTO_RELAY_TEXT.addFirst };
      case "PhotosUnavailable": return UNAVAILABLE;
      default: { const _exhaustive: never = pick; return _exhaustive; }
    }
  }

  private async redraft(who: Who, scene: Scene, draft: PhotoDraft, result: PhotoPickResult | null, wantsSet: boolean): Promise<Spoken> {
    if (draft.purpose === "delete") return result ? this.pickText(scene, "delete", null, result, false) : { text: PHOTO_RELAY_TEXT.whichOne(this.lines(scene, this.slotsOf(scene, draft.shownIds), null)) };
    const thread = scene.threads.find(t => t.threadId === draft.threadId);
    if (!thread || !(await this.partiesOk(who, thread.threadId))) {
      await this.d.sql.begin(tx => this.d.relay.dropDraft(tx, who.personId, who.app));
      return UNAVAILABLE;
    }
    if (!result) return { text: PHOTO_RELAY_TEXT.whichOne(this.lines(scene, this.slotsOf(scene, draft.shownIds), thread.recipientMemberId)) };
    return this.pickText(scene, "send", thread, result, wantsSet);
  }

  private async rechosen(who: Who, scene: Scene, draft: PhotoDraft): Promise<Spoken> {
    const kept = this.slotsOf(scene, draft.proposedIds);
    const result: PhotoPickResult = kept.length ? { pick: "ProposePhotos", chosen: maskOf(kept.map(s => s.n)) }
      : scene.slots.length ? { pick: "ListPhotos", chosen: maskOf(scene.slots.map(s => s.n)) } : { pick: "AddPhotosFirst", chosen: 0 };
    return this.redraft(who, scene, draft, result, draft.wantsSet);
  }

  private async consented(who: Who, scene: Scene, draft: PhotoDraft): Promise<{ offered: boolean; text: string }> {
    if (draft.purpose === "delete") {
      for (const id of draft.proposedIds) await this.d.photos.remove(who.personId, who.app, id);
      await this.d.sql.begin(tx => this.d.relay.dropDraft(tx, who.personId, who.app));
      const left = await this.d.relay.slots(who.personId, who.app);
      return { offered: true, text: left.length ? PHOTO_RELAY_TEXT.deleted(this.lines({ ...scene, slots: left }, left, null)) : PHOTO_RELAY_TEXT.deletedAll };
    }
    const prepared = await this.d.relay.prepareOffer(who.personId, who.app, draft.id, draft.revision, scene.at);
    if (!prepared) return { offered: false, text: PHOTO_RELAY_TEXT.changed };
    const name = prepared.firstName;
    const answer = async (admission: typeof prepared.admission): Promise<{ offered: boolean; text: string }> => {
      switch (admission) {
        case "OfferAsk": case "OfferSilentDecline": return { offered: true, text: PHOTO_RELAY_TEXT.asking(name) };
        case "OfferWaitForAnswer": return { offered: false, text: PHOTO_RELAY_TEXT.waitForAnswer(name) };
        case "OfferCoolingDown": return { offered: false, text: PHOTO_RELAY_TEXT.coolingDown(name, timeWords(await this.coolingEnd(who, prepared.recipientPersonId, scene.at), scene.zone)) };
        case "OfferPhotosOff": return { offered: false, text: PHOTO_RELAY_TEXT.photosOff };
        case "OfferDailyLimit": return { offered: false, text: PHOTO_RELAY_TEXT.dailyLimit };
        case "OfferUnavailable": return { offered: false, text: PHOTO_RELAY_TEXT.unavailable };
        default: { const _exhaustive: never = admission; return _exhaustive; }
      }
    };
    if (prepared.admission !== "OfferAsk" && prepared.admission !== "OfferSilentDecline") return answer(prepared.admission);
    return answer((await this.commitOffer(who, draft, prepared)).admission);
  }

  private async commitOffer(who: Who, draft: PhotoDraft, prepared: PreparedOffer): Promise<Committed> {
    const made = async (tx: SQL, asked: boolean): Promise<Committed> => {
      const r = await prepared.commit(tx);
      if (asked && !(r.admission === "OfferAsk" && r.phase === "asking" && r.offerId)) throw new PhotoAskWithdrawn();
      if (r.offerId) await this.d.relay.dropDraft(tx, who.personId, who.app);
      return r;
    };
    const rrt = prepared.admission === "OfferAsk" ? await this.d.runtimeOfMember(who.app, prepared.recipientMemberId) : undefined;
    if (rrt) {
      const sender = await this.d.relay.firstName(who.app, who.memberId);
      const ask = `${PHOTO_RELAY_TEXT.ask(sender, prepared.count)}${prepared.firstAsk ? PHOTO_RELAY_TEXT.askFirst : ""}`;
      const out: { committed?: Committed } = {};
      try {
        await rrt.unitOfWork(net => {
          const asked = net.photoNotice(prepared.recipientMemberId as MemberId, askKey(`${draft.id}:${draft.revision}`), ask, "relay", prepared.threadId);
          rrt.unit.completeAction = async tx => { out.committed = await made(tx, asked); };
        });
      } catch (e) {
        if (!(e instanceof PhotoAskWithdrawn)) throw e;
      }
      if (out.committed) return out.committed;
    }
    return this.d.sql.begin(tx => made(tx, false));
  }

  private async coolingEnd(who: Who, recipientPersonId: string, at: number): Promise<number> {
    const [row] = await this.d.sql`select max(coalesce(notice_at, changed_at)) as last from platform.photo_offers where app_id=${who.app}
      and sender_person_id=${who.personId}::uuid and recipient_person_id=${recipientPersonId}::uuid and phase in ('declined','lapsed') and not was_ready`;
    return row?.last ? new Date(row.last).getTime() + photoOfferCooldownMs : at;
  }

  private async withdraw(who: Who, scene: Scene, threadId: string | null, numbers: number[] | null, commit?: TextCommit): Promise<Spoken> {
    const ids = numbers === null ? null : scene.slots.filter(s => numbers.includes(s.n)).map(s => s.id);
    if (ids !== null && !ids.length) return { text: PHOTO_RELAY_TEXT.noneToWithdraw };
    const draft = scene.draft?.purpose === "send" ? scene.draft : undefined;
    let threads = threadId === null ? scene.threads : scene.threads.filter(t => t.threadId === threadId);
    if (threadId === null && ids === null) {
      const held = await this.d.relay.holdings(who.personId, who.app, scene.zone);
      const names = new Set(held.flatMap(h => h.access.filter(a => a.state !== "taken_back").map(a => a.firstName.toLowerCase())));
      threads = threads.filter(t => names.has(t.firstName.toLowerCase()) || t.threadId === draft?.threadId);
      if (threads.length > 1) return { text: PHOTO_RELAY_TEXT.takeBackWhich(threads.map(t => t.firstName)), asked: true };
    }
    const dropDraft = !!draft && threads.some(t => t.threadId === draft.threadId) && (ids === null || draft.proposedIds.some(id => ids.includes(id)));
    return this.d.sql.begin(async tx => {
      const done = commit ? await commit(tx) : undefined;
      let revoked = 0;
      const viewing: string[] = [];
      for (const t of threads) {
        const out = await this.d.relay.withdraw(tx, who.app, who.personId, t.threadId, ids);
        revoked += out.revoked;
        if (out.viewing && out.revoked > 0) viewing.push(t.firstName);
      }
      if (dropDraft) await this.d.relay.dropDraft(tx, who.personId, who.app);
      const text = viewing.length ? PHOTO_RELAY_TEXT.withdrawnViewing(viewing.join(" and "))
        : revoked > 0 || dropDraft ? PHOTO_RELAY_TEXT.withdrawn : PHOTO_RELAY_TEXT.noneToWithdraw;
      if (done) await done(text);
      return { text };
    });
  }

  private async speak(who: Who, spoken: Spoken, prompt: DraftPrompt, commit?: TextCommit): Promise<string> {
    if (!spoken.draft) return spoken.text;
    return this.d.sql.begin(async tx => {
      const done = commit ? await commit(tx) : undefined;
      const saved = await this.d.relay.saveDraft(tx, { ...spoken.draft!, personId: who.personId, app: who.app, prompt });
      const text = spoken.link && saved.link ? spoken.text.replaceAll(LINK, saved.link) : spoken.text;
      if (done) await done(text);
      return text;
    });
  }

  private slotsOf(scene: Scene, ids: string[]): PhotoSlot[] {
    return scene.slots.filter(s => ids.includes(s.id));
  }

  private lines(scene: Scene, list: PhotoSlot[], to: string | null): string {
    const name = to === null ? undefined : scene.threads.find(t => t.recipientMemberId === to)?.firstName;
    return list.map(s => {
      const base = `${s.n}${s.label ? ` "${s.label}"` : ""} (${dayWords(s.addedAt, scene.at, scene.zone)})`;
      return to !== null && name && s.sharedWith.includes(to) ? `${base}, ${name} has it` : base;
    }).join("; ");
  }

  private holdingLine(h: PhotoHolding, at: number, zone: string): string {
    const base = `${h.n}${h.label ? ` "${h.label}"` : ""} (${dayWords(h.addedAt, at, zone)})`;
    return [base, ...h.access.map(a => a.state === "ready" ? `${a.firstName} has it` : a.state === "taken_back" ? `taken back from ${a.firstName}` : `waiting for ${a.firstName}`)].join(", ");
  }

  private async partiesOk(who: Who, threadId: string): Promise<boolean> {
    if (!this.d.relay.enabled || (await this.d.photos.mayTake(who.personId, who.app))) return false;
    return !!(await this.d.parties({ app: who.app, threadId, senderPersonId: who.personId }));
  }

  private async threads(rt: NetworkRuntime, memberId: string): Promise<ReaderThread[]> {
    const live = await rt.readState(n => n.relayLiveMatches(memberId as MemberId));
    return live.map(l => ({ threadId: l.match.id, recipientMemberId: l.match.participants.find(p => p !== memberId)!, firstName: firstNameOf(l.otherFirstName) }));
  }

  private async zoneOf(rt: NetworkRuntime, memberId: string): Promise<string> {
    const [row] = await rt.scoped(tx => tx`select city.tz from network.members m left join platform.cities city on city.id=m.home_city
      where m.app_id=${rt.app.id} and m.id=${memberId}`);
    return isValidTimeZone(row?.tz) ? row.tz : PHOTO_RELAY_TIME_ZONE;
  }

  private async newestOutbound(who: Who): Promise<{ id: string; ts: number } | undefined> {
    const [row] = await who.rt.scoped(tx => tx`select id,ts from network.messages where app_id=${who.app} and member_id=${who.memberId}
      and direction='outbound' order by ts desc,id desc limit 1`);
    return row ? { id: row.id as string, ts: new Date(row.ts).getTime() } : undefined;
  }

  private async inboundSince(e164: string, rowId: string, since: number): Promise<boolean> {
    const rows = await this.d.sql`select 1 from platform.inbound where sender_hash=${this.d.phoneKey(e164)} and id<>${inboundRowOf(rowId)}
      and arrived_at>${new Date(since)} limit 1`;
    return rows.length > 0;
  }

  private async askIsNewest(who: Who, e164: string, rowId: string, offerId: string, draft: PhotoDraft | undefined): Promise<boolean> {
    const [newest, offer] = await Promise.all([this.newestOutbound(who), this.d.relay.offer(offerId)]);
    if (!newest || !offer || newest.id !== askKey(offer.requestKey)) return false;
    if (draft && draft.shownAt > newest.ts) return false;
    return !(await this.inboundSince(e164, rowId, newest.ts));
  }

  private async readyOfferPrompted(who: Who, e164: string, rowId: string, draft: PhotoDraft | undefined): Promise<string | undefined> {
    const newest = await this.newestOutbound(who);
    const id = newest && /^photo-ready:(.+)$/.exec(newest.id)?.[1];
    if (!id || (draft && draft.shownAt > newest.ts) || (await this.inboundSince(e164, rowId, newest.ts))) return undefined;
    return id;
  }

  private async draftIsNewest(who: Who, e164: string, rowId: string, draft: PhotoDraft): Promise<boolean> {
    const newest = await this.newestOutbound(who);
    if (draft.promptVia === "send") return !!newest && newest.id === draft.promptKey && !(await this.inboundSince(e164, rowId, newest.ts));
    if (newest && newest.ts >= draft.shownAt) return false;
    const [current] = await this.d.sql`select arrived_at from platform.inbound where id=${inboundRowOf(rowId)}`;
    const [previous] = await this.d.sql`select id from platform.inbound where sender_hash=${this.d.phoneKey(e164)} and id<>${inboundRowOf(rowId)}
      ${current ? this.d.sql`and arrived_at<=${current.arrived_at}` : this.d.sql``} order by arrived_at desc,id desc limit 1`;
    return !!previous && !!draft.promptInboundId && previous.id === inboundRowOf(draft.promptInboundId);
  }
}
