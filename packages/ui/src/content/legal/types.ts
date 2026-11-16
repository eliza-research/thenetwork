// spec/sitePages.md, "The terms page has a text messaging section that a link can open"
import type { ReactNode } from "react";
import type { OptInWay, SmsTermsItem } from "../../../../core/src/generated/sitePages.ts";

/** One titled section of a legal page. */
export interface LegalSection {
  /** The section heading. */
  heading: string;
  /** The paragraphs and lists of the section. */
  body: ReactNode;
}

/** The text messaging terms of one site, one entry for each item of `smsTermsItems`. */
export interface SmsTermsText {
  /** The section heading. */
  heading: string;
  /** One sentence before the list. */
  lead?: ReactNode;
  /** The list item for each item except the opt-in item. */
  items: Record<Exclude<SmsTermsItem, "SmsOptIn">, ReactNode>;
  /** The opt-in item: its label, one text for each way the site can offer, and the sentences after the ways. */
  optIn: { label: ReactNode; ways: Partial<Record<OptInWay, ReactNode>>; close?: ReactNode };
  /** A list item that follows the opt-in item. */
  optInNote?: ReactNode;
}

/** The place of the text messaging terms among the sections of the terms. */
export interface SmsSlot {
  sms: SmsTermsText;
}

/** A privacy policy or the terms of one site. */
export interface LegalText {
  /** The page heading. */
  title: string;
  /** The effective date line. */
  effective: string;
  /** The paragraph under the date. */
  intro: ReactNode;
  /** The sections in page order. */
  sections: (LegalSection | SmsSlot)[];
}
