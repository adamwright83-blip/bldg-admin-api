/**
 * Reading a CleanCloud Driver App screenshot.
 *
 * This produces a PROPOSAL, never business truth. Vision extraction is a
 * best-effort reading of somebody else's UI, and it will sometimes misread a
 * name, an address, or a time window. So nothing here persists anything and
 * nothing here is trusted: the caller shows the result to the operator, who
 * corrects and confirms it before a single row is written.
 *
 * The prompt is written to make the model's failure mode OMISSION rather than
 * INVENTION. A missing address is a field the operator fills in; a plausible
 * hallucinated address is a driver sent to the wrong building.
 */
import { invokeLLM } from "../_core/llm";
import type {
  ExtractedExternalJob,
  ExternalImportProposal,
} from "../../shared/externalOperationalOrder";
import { randomUUID } from "node:crypto";

/**
 * Claude Opus 5 — the strongest available reading of a dense, unfamiliar
 * mobile UI, which is exactly what a competitor's driver app is. Extraction
 * accuracy here is worth more than the token difference: a misread row costs
 * the operator a correction at best and a wrong-address drive at worst.
 */
const EXTRACTION_MODEL = "claude-opus-5";

const EXTRACTION_SYSTEM = [
  "You read a screenshot of a laundry driver's job list and report the jobs visible in it.",
  "",
  "You are transcribing, not interpreting. Report only what is legibly present.",
  "",
  "RULES",
  "- Report every distinct job row you can see, in the order they appear.",
  "- If a field is not visible or not legible, return null for it. Never guess.",
  "- Never invent a customer, address, time, or order number that is not on screen.",
  "- Do not infer an address from a customer name, or a name from an address.",
  "- If the screenshot shows no job rows at all, return an empty list.",
  "- A job is a PICKUP when the app marks it as collection/pickup, and a DROPOFF",
  "  when it is marked delivery/dropoff/return. If the screenshot does not say,",
  "  choose the one the surrounding UI most clearly indicates; do not default blindly.",
  "",
  "It is far better to return null for a field than to return a plausible value",
  "you are not reading directly off the image. A human reviews everything you",
  "return and fills the gaps; they cannot catch a confident invention as easily.",
].join("\n");

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["jobs", "readable"],
  properties: {
    readable: {
      type: "boolean",
      description:
        "True if this image showed a legible job list. False if it is blank, unrelated, or unreadable.",
    },
    jobs: {
      type: "array",
      description: "Every job row visible in the screenshot, in display order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "jobKind",
          "customerName",
          "address",
          "scheduledDate",
          "windowStart",
          "windowEnd",
          "notes",
          "externalOrderId",
        ],
        properties: {
          jobKind: {
            type: "string",
            enum: ["pickup", "dropoff"],
          },
          customerName: {
            type: "string",
            description: "Customer name exactly as shown.",
          },
          address: {
            type: ["string", "null"],
            description: "Address or building as shown. Null if not visible.",
          },
          scheduledDate: {
            type: ["string", "null"],
            description: "YYYY-MM-DD if a date is shown. Null otherwise.",
          },
          windowStart: {
            type: ["string", "null"],
            description: "24h HH:MM start of the time window. Null if none shown.",
          },
          windowEnd: {
            type: ["string", "null"],
            description: "24h HH:MM end of the time window. Null if none shown.",
          },
          notes: {
            type: ["string", "null"],
            description: "Any visible instruction or note attached to the job.",
          },
          externalOrderId: {
            type: ["string", "null"],
            description: "The order/ticket number shown by the app, if any.",
          },
        },
      },
    },
  },
} as const;

type ExtractionPayload = {
  readable: boolean;
  jobs: ExtractedExternalJob[];
};

/** A single screenshot's worth of reading. */
async function extractOneImage(dataUrl: string): Promise<ExtractionPayload> {
  const result = await invokeLLM({
    model: EXTRACTION_MODEL,
    maxTokens: 4096,
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          {
            type: "text",
            text: "List every job visible in this driver app screenshot.",
          },
        ],
      },
    ],
    outputSchema: {
      name: "cleancloud_day",
      schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
    },
  });

  const raw = result.choices[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  let parsed: ExtractionPayload | undefined;
  try {
    parsed = JSON.parse(text) as ExtractionPayload;
  } catch {
    // Unparseable output is an unreadable image, not a crash. The operator
    // still gets whatever the other screenshots produced.
    return { readable: false, jobs: [] };
  }
  if (!parsed || !Array.isArray(parsed.jobs)) {
    return { readable: false, jobs: [] };
  }
  return { readable: Boolean(parsed.readable), jobs: parsed.jobs };
}

/**
 * Normalises one extracted row.
 *
 * Blank strings become null rather than empty text, so a field the model
 * couldn't read reaches the review screen visibly missing instead of quietly
 * present-but-empty — the operator needs to see the gap to fill it.
 */
function normalizeJob(job: ExtractedExternalJob): ExtractedExternalJob | null {
  const customerName = (job.customerName ?? "").trim();
  // A job with no customer is not a job we can meaningfully review or drive
  // to. Dropping it is more honest than surfacing a nameless row.
  if (!customerName) return null;
  const clean = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    jobKind: job.jobKind === "dropoff" ? "dropoff" : "pickup",
    customerName,
    address: clean(job.address),
    scheduledDate: clean(job.scheduledDate),
    windowStart: clean(job.windowStart),
    windowEnd: clean(job.windowEnd),
    notes: clean(job.notes),
    externalOrderId: clean(job.externalOrderId),
  };
}

/**
 * Reads one or more screenshots into a reviewable proposal.
 *
 * Images are read independently and concatenated in upload order. An
 * unreadable image is COUNTED rather than silently skipped: an operator who
 * uploaded four screenshots and sees jobs from three of them needs to know
 * that, or they will assume the fourth simply had nothing on it.
 */
export async function extractExternalDayFromScreenshots(input: {
  images: string[];
}): Promise<ExternalImportProposal> {
  const readings = await Promise.all(
    input.images.map(async image => {
      try {
        return await extractOneImage(image);
      } catch {
        // A provider error is an unreadable image from the operator's point of
        // view. Failing the whole import because one of four screenshots
        // errored would throw away three good readings.
        return { readable: false, jobs: [] } satisfies ExtractionPayload;
      }
    })
  );

  const jobs: ExtractedExternalJob[] = [];
  let unreadableImageCount = 0;
  for (const reading of readings) {
    const normalized = reading.jobs
      .map(normalizeJob)
      .filter((job): job is ExtractedExternalJob => job !== null);
    if (!reading.readable && normalized.length === 0) {
      unreadableImageCount += 1;
      continue;
    }
    jobs.push(...normalized);
  }

  return { batchId: randomUUID(), jobs, unreadableImageCount };
}
