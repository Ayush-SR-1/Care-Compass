import { Router, type IRouter } from "express";
import {
  CreateCareCompassPlanBody,
  CreateCareCompassPlanResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const MAX_DOCUMENT_BYTES = 7 * 1024 * 1024;
const EMERGENCY_MESSAGE =
  "Seek emergency care now. Call your local emergency number or go to the nearest emergency department.";

const SYSTEM_PROMPT = `You are CareCompass, a patient-support and hospital-navigation assistant. You are NOT a diagnostic tool and must not provide medical advice.

Safety rules:
- Never diagnose, suggest a diagnosis, interpret a medical test as a diagnosis, or recommend, stop, or change any medicine or dose.
- Only extract medicines, dosages, dates, doctor names, and prior conditions that are explicitly written in the user's message or document. Never guess or infer missing details. Use null for a missing dosage or instruction and empty arrays when nothing is stated.
- If the user describes emergency symptoms such as chest pain, trouble breathing, heavy bleeding, stroke signs, unconsciousness, a severe allergic reaction, or an ongoing seizure, set emergency.detected=true, set urgency to urgent-seek-care-now, and use this emergency message: "${EMERGENCY_MESSAGE}"
- For non-emergency requests, use routine or soon only to describe navigation urgency, not medical severity. When uncertain, state that the user should contact a clinician or hospital.
- Recommend only a relevant hospital service department. Common options include Dermatology, Cardiology, Orthopedics, ENT, Pediatrics, Gynecology, Neurology, Ophthalmology, General Medicine, Gastroenterology, Urology, and Pulmonology. Do not imply that the user has a particular condition.
- Never tell a person to fast. If preparation is unclear, put "Confirm any fasting instructions with your care team" in the checklist.
- Include a practical visit checklist when relevant: bring prior records or prescriptions, bring ID and insurance details if applicable, confirm fasting instructions with the care team rather than guessing, ask whether arriving early is needed, and write down concerns or questions. Mark every item unchecked.
- Keep the summary plain-language and limited to what the document says. Say when text is unclear or unavailable.
- Replace every angle-bracket placeholder below with actual content; never return placeholder text. For unavailable optional details, use JSON null or an empty array as appropriate.
- Return exactly one valid JSON object matching this schema, with no markdown or surrounding text:
{
  "department": { "name": "<relevant hospital department>", "reason": "<brief reason based on the request>", "urgency": "routine" },
  "extractedInformation": {
    "medicines": [],
    "dates": ["string"], "doctors": ["string"], "previousConditions": ["string"], "otherDetails": ["string"]
  },
  "visitChecklist": [{ "id": "<short-unique-id>", "label": "<checklist item>", "checked": false }],
  "documentSummary": null,
  "questionsToAskDoctor": ["<relevant, non-diagnostic question>", "<question>", "<question>", "<question>", "<question>"],
  "emergency": { "detected": false, "message": null }
}`;

const EMERGENCY_PATTERNS = [
  /\bchest pain\b/i,
  /\b(?:trouble|difficulty)\s+breathing\b/i,
  /\b(?:can'?t|cannot)\s+breathe\b/i,
  /\bheavy bleeding\b/i,
  /\b(?:face droop(?:ing)?|slurred speech|sudden weakness|stroke signs?)\b/i,
  /\b(?:unconscious|not waking up|severe allergic reaction|anaphylaxis)\b/i,
  /\b(?:ongoing|right now|currently)\s+seizure\b/i,
];

function describesEmergency(text: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) return false;
    const precedingText = text.slice(Math.max(0, match.index - 40), match.index);
    const isNegated =
      /\b(?:no|not|denies?|denied|without|never|don't have|doesn't have|didn't have)\b(?:\s+\w+){0,3}\s*$/i.test(
        precedingText,
      );
    return !isNegated;
  });
}

function getTextBlock(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      return block.text;
    }
  }
  return null;
}

router.post("/carecompass/navigate", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, private");

  const parsed = CreateCareCompassPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Describe what help you need, using at least 3 characters." });
    return;
  }

  const {
    situation,
    documentText,
    fileName,
    mediaType,
    documentBase64,
  } = parsed.data;
  const hasAnyFileField =
    fileName !== undefined ||
    mediaType !== undefined ||
    documentBase64 !== undefined;
  const hasCompleteFile =
    fileName !== undefined &&
    mediaType !== undefined &&
    documentBase64 !== undefined;

  if (hasAnyFileField && !hasCompleteFile) {
    res.status(400).json({ error: "The attached document could not be read. Please upload it again." });
    return;
  }

  let decodedDocument: Buffer | null = null;
  if (documentBase64 && mediaType) {
    const base64 = documentBase64.replace(/^data:[^,]+;base64,/i, "");
    const supportedMediaTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ]);

    if (
      !supportedMediaTypes.has(mediaType) ||
      base64.length === 0 ||
      base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) {
      res.status(400).json({ error: "Upload a PDF, JPEG, PNG, GIF, or WebP file." });
      return;
    }

    decodedDocument = Buffer.from(base64, "base64");
    if (decodedDocument.byteLength > MAX_DOCUMENT_BYTES) {
      res.status(413).json({ error: "That file is too large. Choose a file smaller than 7 MB." });
      return;
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error:
        "Claude is not configured yet. Add ANTHROPIC_API_KEY to Replit Secrets to enable navigation plans.",
    });
    return;
  }

  const message = [
    `Patient's situation:\n${situation}`,
    documentText?.trim()
      ? `\nAdditional text copied from their document:\n${documentText.trim()}`
      : "",
    "\nProvide navigation help only. Do not diagnose or recommend treatment.",
  ].join("");

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: message },
  ];

  if (decodedDocument && mediaType === "application/pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: decodedDocument.toString("base64"),
      },
    });
  } else if (decodedDocument && mediaType?.startsWith("image/")) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: decodedDocument.toString("base64"),
      },
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      req.log.warn(
        { statusCode: response.status },
        "Anthropic rejected a CareCompass request",
      );
      res.status(502).json({
        error: "Claude could not process this request. Please try again in a moment.",
      });
      return;
    }

    const payload: unknown = await response.json();
    const text = getTextBlock(
      payload && typeof payload === "object" && "content" in payload
        ? payload.content
        : null,
    );
    if (!text) {
      res.status(502).json({
        error: "Claude returned an unreadable response. Please try again.",
      });
      return;
    }

    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      res.status(502).json({
        error: "Claude returned an unreadable response. Please try again.",
      });
      return;
    }

    const validated = CreateCareCompassPlanResponse.safeParse(result);
    if (!validated.success) {
      res.status(502).json({
        error: "Claude's response did not match the required plan format. Please try again.",
      });
      return;
    }

    const emergencyDetected =
      validated.data.emergency.detected ||
      validated.data.department.urgency === "urgent-seek-care-now" ||
      describesEmergency([situation, documentText ?? ""].join(" "));
    const plan = {
      ...validated.data,
      department: {
        ...validated.data.department,
        urgency: emergencyDetected
          ? ("urgent-seek-care-now" as const)
          : validated.data.department.urgency,
      },
      emergency: emergencyDetected
        ? { detected: true, message: EMERGENCY_MESSAGE }
        : { detected: false, message: null },
    };

    res.json(CreateCareCompassPlanResponse.parse(plan));
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    req.log.error({ errorName }, "CareCompass request failed");
    res.status(502).json({
      error: "We could not reach Claude right now. Please try again shortly.",
    });
  }
});

export default router;
