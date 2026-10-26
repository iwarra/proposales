import type { CountField, DatesField, Reading } from "../ai";
import type { Enquiry } from "../enquiries";

export type Recipient = { first_name?: string; last_name?: string; email?: string; company_name?: string };

export type ProposalBody = {
  company_id: number;
  language: "en";
  title_md: string;
  description_md: string;
  recipient?: Recipient;
  data: { enquiry_id: string; source: "enquiry-desk" };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * Proposales' markdown is not CommonMark. Checked against a real draft's description_html:
 * *text* is bold, a newline is a line break and a blank line starts a paragraph.
 * **text**, "- " lists and "> " quotes are shown as typed. So only those three are used here.
 */
const bold = (text: string) => `*${text}*`;
const TO_CONFIRM = bold("(approximate — to confirm)");

/** Client and AI text: a "*" would toggle bold, so it becomes "∗", which looks the same. */
const plainText = (text: string) => text.replace(/\*/g, "∗");

/** "2027-03-12" → "12 Mar 2027", read straight from the string so no timezone can shift it. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatDateRange(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

/** Exact values formatted, approximate ones as the client wrote them. Ambiguous and missing never reach a draft. */
function plain(field: DatesField | CountField): string | null {
  if (field.kind === "exact") return "startDate" in field ? formatDateRange(field.startDate, field.endDate) : String(field.count);
  if (field.kind === "approximate") return plainText(field.asStated);
  return null;
}

function line(label: string, field: DatesField | CountField, exactText?: (value: string) => string): string | null {
  const value = plain(field);
  if (value === null) return null;
  if (field.kind === "approximate") return `${bold(`${label}:`)} ${value} ${TO_CONFIRM}`;
  return `${bold(`${label}:`)} ${exactText ? exactText(value) : value}`;
}

function recipientOf(contact: { company: string | null; name: string | null; email: string | null }): Recipient | undefined {
  const recipient: Recipient = {};
  const name = contact.name?.trim().replace(/\s+/g, " ");
  if (name) {
    const split = name.lastIndexOf(" ");
    if (split === -1) recipient.first_name = name;
    else {
      recipient.first_name = name.slice(0, split);
      recipient.last_name = name.slice(split + 1);
    }
  }
  const email = contact.email?.trim().toLowerCase();
  // Proposales rejects the whole request on a malformed email, so it's left out.
  if (email && EMAIL.test(email)) recipient.email = email;
  if (contact.company?.trim()) recipient.company_name = contact.company.trim();
  return Object.keys(recipient).length > 0 ? recipient : undefined;
}

/** Reading → the create-proposal body. Pure. `toCheck` comes from decide(). */
export function buildProposalBody(input: { enquiry: Enquiry; reading: Reading; toCheck: string[]; companyId: number }): ProposalBody {
  const { enquiry, reading, toCheck, companyId } = input;
  // A value from the sheet always wins over the AI's.
  const contact = {
    company: enquiry.company ?? reading.contact.company,
    name: enquiry.contactName ?? reading.contact.name,
    email: enquiry.contactEmail ?? reading.contact.email,
  };

  const who = plainText(contact.company ?? contact.name ?? "New enquiry");
  const what = reading.eventName ? plainText(reading.eventName) : `${plain(reading.guests)} guests`;
  const title = `${who}: ${what}, ${plain(reading.dates)}`;

  const details = [
    line("Dates", reading.dates),
    line("Guests", reading.guests),
    line("Rooms", reading.rooms, (count) => (count === "0" ? "none" : count)),
    reading.meetingSpace && `${bold("Meeting space:")} ${plainText(reading.meetingSpace)}`,
    reading.catering && `${bold("Catering:")} ${plainText(reading.catering)}`,
    reading.notes && `${bold("Notes:")} ${plainText(reading.notes)}`,
  ].filter(Boolean);

  const sections = [details.join("\n")];
  if (toCheck.length > 0) sections.push([bold("To check"), ...toCheck.map((item) => `• ${plainText(item)}`)].join("\n"));
  // Blank lines inside the enquiry would split it into paragraphs, so it's kept as one block of lines.
  const original = enquiry.message.split(/\n+/).map(plainText).join("\n");
  sections.push(`${bold("Original enquiry")}\n${original}`);

  const recipient = recipientOf(contact);
  return {
    company_id: companyId,
    language: "en",
    title_md: title,
    description_md: sections.join("\n\n"),
    ...(recipient && { recipient }),
    data: { enquiry_id: enquiry.id, source: "enquiry-desk" },
  };
}
