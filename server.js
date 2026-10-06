const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4';

// Middleware - JSON limit 15mb, CORS enabled
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve built frontend if dist exists
const distPath = path.join(__dirname, 'artifacts', 'carecompass', 'dist', 'public');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Load Hospital KB
const kbPath = path.join(__dirname, 'hospital_kb.json');
let kb = {
  departments: [],
  data_note: "Doctor details compiled from public hospital directories. They may be out of date. Confirm availability with the hospital."
};

try {
  kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  console.log(`[KB] Successfully loaded ${kb.departments?.length || 0} departments from hospital_kb.json.`);
} catch (err) {
  console.error('[KB Error] Failed to read hospital_kb.json:', err.message);
}

const depts = kb.departments || [];

// Helper functions for doctor & department resolution
const norm = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");

const surnameCounts = {};
const allDoctorsIndex = [];

depts.forEach(dept => {
  (dept.doctors || []).forEach(doc => {
    const clean = doc.name.replace(/\b(dr\.?|\(col\)|col\.?)\b/gi, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    const surname = parts.length > 1 ? norm(parts[parts.length - 1]) : null;
    if (surname) {
      surnameCounts[surname] = (surnameCounts[surname] || 0) + 1;
    }
    allDoctorsIndex.push({ doc, dept, clean, parts, surname });
  });
});

// Helper to format doctor for response (mapping profile_url -> profileUrl)
function formatDoctor(doc) {
  if (!doc) return null;
  return {
    name: doc.name,
    specialty: doc.specialty || '',
    hospital: doc.hospital || '',
    city: doc.city || '',
    qualification: doc.qualification || '',
    experience: doc.experience || '',
    languages: Array.isArray(doc.languages) ? doc.languages : [],
    timing: doc.timing || 'Confirm with OPD desk',
    location: doc.location || 'Ask at reception',
    profileUrl: doc.profile_url ?? null
  };
}

// Helper to find department from KB
function findDept(name) {
  const n = norm(name);
  if (!n) return depts.find(d => norm(d.name) === norm("General Medicine")) || depts[0];
  let matched = depts.find(d => norm(d.name) === n);
  if (!matched) {
    matched = depts.find(d => norm(d.name).includes(n) || n.includes(norm(d.name)));
  }
  return matched || depts.find(d => norm(d.name) === norm("General Medicine")) || depts[0];
}

// Doctor-name search on user message:
// - match on full name
// - OR first name + surname together
// - match on surname alone ONLY if unique across all 50 doctors
function findDoctorInMessage(message) {
  if (!message) return null;
  const msgNorm = norm(message);

  // 1. Check full clean name match first
  for (const entry of allDoctorsIndex) {
    const fullNorm = norm(entry.clean);
    if (fullNorm && fullNorm.length >= 6 && msgNorm.includes(fullNorm)) {
      return { doctor: entry.doc, department: entry.dept };
    }
  }

  // 2. Check first name + surname together
  for (const entry of allDoctorsIndex) {
    if (entry.parts.length >= 2) {
      const firstLastNorm = norm(entry.parts[0] + entry.parts[entry.parts.length - 1]);
      if (firstLastNorm && firstLastNorm.length >= 6 && msgNorm.includes(firstLastNorm)) {
        return { doctor: entry.doc, department: entry.dept };
      }
    }
  }

  // 3. Match on surname alone ONLY if unique across all 50 doctors
  for (const entry of allDoctorsIndex) {
    if (entry.surname && entry.surname.length >= 4 && surnameCounts[entry.surname] === 1) {
      if (msgNorm.includes(entry.surname)) {
        return { doctor: entry.doc, department: entry.dept };
      }
    }
  }

  return null;
}

// Keyword Red-Flag Regex with Negation Lookbehind / Check
const RED_FLAG_REGEX = /\b(chest\s*pain|heart\s*attack|angina|severe\s*chest\s*(tightness|heaviness|pressure)|crushing\s*chest|trouble\s*breathing|difficulty\s*breathing|shortness\s*of\s*breath|can't\s*breathe|cannot\s*breathe|unable\s*to\s*breathe|gasping\s*for\s*air|suffocating|choking|severe\s*bleeding|profuse\s*bleeding|uncontrolled\s*bleeding|coughing\s*(up\s*)?blood|vomiting\s*blood|blood\s*vomit|stroke|face\s*droop|facial\s*droop|slurred\s*speech|speech\s*slurring|arm\s*weakness|loss\s*of\s*consciousness|passed\s*out|fainted|unresponsive|collapsed|loss\s*of\s*balance\s*sudden|blacked\s*out|seizure|convulsion|convulsions|epileptic\s*fit|self[- ]?harm|kill\s*myself|end\s*my\s*life|commit\s*suicide|suicidal|overdose|overdosed|swallowed\s*poison|poisoned|cyanide|bleach\s*drink|anaphylaxis|throat\s*swelling|tongue\s*swelling)\b/gi;

function checkEmergencyKeywords(text) {
  if (!text) return false;
  let match;
  RED_FLAG_REGEX.lastIndex = 0;
  while ((match = RED_FLAG_REGEX.exec(text)) !== null) {
    const preceding = text.slice(Math.max(0, match.index - 40), match.index);
    const isNegated = /\b(no|not|denies|denied|without|never|don't have|doesn't have|didn't have|free of)\b(?:\s+\w+){0,3}\s*$/i.test(preceding);
    if (!isNegated) {
      return true;
    }
  }
  return false;
}

function buildEmergencyResponse() {
  return {
    emergency: {
      detected: true,
      message: 'Seek emergency care immediately. Call 112 (or your local emergency number) or go to the nearest emergency department right away.'
    },
    department: {
      name: 'Emergency Medicine',
      reason: 'Potential emergency detected from reported symptoms. Immediate emergency evaluation is required.',
      urgency: 'urgent-seek-care-now'
    },
    extractedInformation: {
      medicines: [],
      dates: [],
      doctors: [],
      previousConditions: [],
      otherDetails: []
    },
    visitChecklist: [],
    documentSummary: null,
    questionsToAskDoctor: [],
    doctors: [],
    relatedDepartments: [],
    matchedDoctor: null,
    dataNote: kb.data_note || 'Doctor details compiled from public hospital directories. They may be out of date. Confirm availability with the hospital.'
  };
}

// Stripped departments for model (no doctors, no hospital)
const strippedDepts = depts.map(d => ({
  name: d.name,
  reasons: d.reasons,
  docs: d.docs
}));

const deptNamesList = depts.map(d => d.name).join(', ');

// System Prompt Builder
function buildSystemPrompt(language = 'English') {
  return `You are a hospital navigation assistant. You help patients prepare for a hospital visit. You are NOT a doctor.

STRICT RULES
1. Never diagnose, never name a likely condition, never recommend, start, stop or change any medicine or dose.
2. Choose the department ONLY from the list: ${deptNamesList}. If nothing fits, choose "General Medicine".
3. Set department.urgency to "routine", "soon", or "urgent-seek-care-now".
4. Set relatedDepartments to an array of 0-2 department names from the department list that could also fit the patient's problem, excluding the primary department. Use [] when the primary department is a clear fit. Never name doctors or hospitals in relatedDepartments.
5. If the patient's message describes a possible emergency (chest pain, trouble breathing, severe bleeding, stroke signs such as face drooping or slurred speech, loss of consciousness, seizure, thoughts of self-harm, overdose), set emergency.detected to true, emergency.message to a clear emergency warning, and leave checklist and questions empty.
6. If a document is provided, restate only what is written in it. Extract medicines ({ name, dosage, instructions }), dates, doctors, previousConditions, and otherDetails. Copy names and dosages EXACTLY as written. If a detail is unreadable or absent, set to null or omit. Never guess.
7. If no document is provided, set documentSummary to null.
8. Build visitChecklist as an array of items ({ id: string, label: string, checked: false }) from the chosen department's docs list plus basics: photo ID, insurance card, list of medicines/allergies.
9. Write 5 questions the patient can ask the doctor in questionsToAskDoctor. Base them on the patient's stated reason and the document. They must be about understanding, follow-up, tests, and what to expect. Never ask for a diagnosis or prescription.
10. Write ALL text values in ${language}. Keep JSON keys in English. Use short, plain sentences.
11. Return valid JSON only, matching the schema. No markdown and no commentary.

HOSPITAL_KB
${JSON.stringify(strippedDepts, null, 2)}`;
}

// Ollama Output Schema
const OLLAMA_CONTRACT_SCHEMA = {
  type: "object",
  properties: {
    emergency: {
      type: "object",
      properties: {
        detected: { type: "boolean" },
        message: { anyOf: [{ type: "string" }, { type: "null" }] }
      },
      required: ["detected", "message"]
    },
    department: {
      type: "object",
      properties: {
        name: { type: "string" },
        reason: { type: "string" },
        urgency: { type: "string", enum: ["routine", "soon", "urgent-seek-care-now"] }
      },
      required: ["name", "reason", "urgency"]
    },
    relatedDepartments: {
      type: "array",
      items: { type: "string" }
    },
    extractedInformation: {
      type: "object",
      properties: {
        medicines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              dosage: { anyOf: [{ type: "string" }, { type: "null" }] },
              instructions: { anyOf: [{ type: "string" }, { type: "null" }] }
            },
            required: ["name", "dosage", "instructions"]
          }
        },
        dates: { type: "array", items: { type: "string" } },
        doctors: { type: "array", items: { type: "string" } },
        previousConditions: { type: "array", items: { type: "string" } },
        otherDetails: { type: "array", items: { type: "string" } }
      },
      required: ["medicines", "dates", "doctors", "previousConditions", "otherDetails"]
    },
    documentSummary: { anyOf: [{ type: "string" }, { type: "null" }] },
    visitChecklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          checked: { type: "boolean" }
        },
        required: ["id", "label", "checked"]
      }
    },
    questionsToAskDoctor: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["emergency", "department", "relatedDepartments", "extractedInformation", "documentSummary", "visitChecklist", "questionsToAskDoctor"]
};

// Fallback keyword routing
function fallbackPlan(situation, language = 'English') {
  const msgNorm = (situation || "").toLowerCase();
  let bestDept = depts.find(d => norm(d.name) === norm("General Medicine")) || depts[0];
  let maxMatches = 0;
  let related = [];

  for (const dept of depts) {
    let matches = 0;
    const deptNorm = dept.name.toLowerCase();
    if (msgNorm.includes(deptNorm)) matches += 5;

    for (const reason of dept.reasons) {
      const words = reason.toLowerCase().split(/[,\s/()]+/);
      for (const w of words) {
        if (w.length > 3 && msgNorm.includes(w)) {
          matches += 1;
        }
      }
    }

    if (matches > maxMatches) {
      if (maxMatches > 0 && bestDept && bestDept.name !== dept.name) {
        related = [bestDept.name];
      }
      maxMatches = matches;
      bestDept = dept;
    } else if (matches > 0 && dept.name !== bestDept.name && related.length < 2) {
      related.push(dept.name);
    }
  }

  return {
    emergency: { detected: false, message: null },
    department: {
      name: bestDept.name,
      reason: `Matched relevant consultation profile for ${bestDept.name}`,
      urgency: 'routine'
    },
    relatedDepartments: related.slice(0, 2),
    extractedInformation: {
      medicines: [],
      dates: [],
      doctors: [],
      previousConditions: [],
      otherDetails: []
    },
    documentSummary: null,
    visitChecklist: [
      ...bestDept.docs.map((d, i) => ({ id: `doc-${i}`, label: d, checked: false })),
      { id: 'base-id', label: 'Photo ID (Aadhaar, Voter ID, Passport or Driving License)', checked: false },
      { id: 'base-ins', label: 'Health insurance card / policy details or hospital card', checked: false },
      { id: 'base-meds', label: 'List of all current medications and allergies', checked: false }
    ],
    questionsToAskDoctor: [
      'What are the next diagnostic tests or evaluations needed?',
      'Are there specific symptoms or changes I should watch out for?',
      'What lifestyle or daily routine adjustments should I follow?',
      'When should I schedule a follow-up review?',
      'Should I continue or pause any of my current supplements or medicines?'
    ]
  };
}

// Core navigation handler
async function handleNavigateRequest(req, res) {
  try {
    const {
      situation,
      documentText,
      fileName,
      mediaType,
      documentBase64,
      language = 'English'
    } = req.body;

    // 1. Validate situation (3-3000 chars)
    if (!situation || typeof situation !== 'string' || situation.trim().length < 3 || situation.trim().length > 3000) {
      return res.status(400).json({ error: 'Describe what help you need, using at least 3 characters.' });
    }

    // 2. Validate file attachment parameters
    const hasFilePayload = Boolean(documentBase64 || fileName || mediaType);
    if (hasFilePayload) {
      if (!documentBase64 || !fileName || !mediaType) {
        return res.status(400).json({ error: 'The attached document could not be read. Please upload it again.' });
      }

      const allowedMediaTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMediaTypes.includes(mediaType)) {
        return res.status(400).json({ error: 'Please upload a PDF or an image (JPEG, PNG, GIF, WebP).' });
      }
    }

    // 3. Check Base64 decoded size limit (7 MB)
    let processedImages = [];
    let extractedDocText = documentText ? documentText.trim() : '';

    if (documentBase64) {
      let cleanBase64 = documentBase64;
      if (cleanBase64.includes(',')) {
        cleanBase64 = cleanBase64.split(',')[1];
      }

      const byteLength = Buffer.byteLength(cleanBase64, 'base64');
      if (byteLength > 7 * 1024 * 1024) {
        return res.status(413).json({ error: 'That file is too large. Choose a file smaller than 7 MB.' });
      }

      const fileBuffer = Buffer.from(cleanBase64, 'base64');

      try {
        if (mediaType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
          console.log(`[PDF] Extracting text from PDF "${fileName}"...`);
          const pdfParse = require('pdf-parse');
          const pdfData = await pdfParse(fileBuffer, { max: 2 });
          const text = pdfData.text ? pdfData.text.trim() : '';
          if (text) {
            extractedDocText += `\n\n[DOCUMENT CONTENT FROM ${fileName}]:\n${text}`;
            console.log(`[PDF] Extracted ${text.length} chars from PDF.`);
          }
        } else if (mediaType === 'image/webp' || mediaType === 'image/gif') {
          console.log(`[Sharp] Converting ${mediaType} to PNG...`);
          const sharp = require('sharp');
          const pngBuffer = await sharp(fileBuffer).png().toBuffer();
          processedImages.push(pngBuffer.toString('base64'));
        } else {
          processedImages.push(cleanBase64);
        }
      } catch (err) {
        console.error('[Document Processing Error]', err.message);
        return res.status(422).json({ error: 'Could not read that document. Please try a different scan or enter the text manually.' });
      }
    }

    // 4. Check for Emergency Red Flags (negation-aware)
    const combinedForEmergency = `${situation} ${extractedDocText}`;
    if (checkEmergencyKeywords(combinedForEmergency)) {
      console.log('[SAFETY] Red-flag detected in user request. Returning emergency navigation response.');
      return res.json(buildEmergencyResponse());
    }

    // 5. Build Ollama Prompt & Call Model
    const systemPrompt = buildSystemPrompt(language);
    let userPrompt = situation.trim();
    if (extractedDocText) {
      userPrompt += `\n\n[DOCUMENT ATTACHMENT / EXTRACTED TEXT]:\n${extractedDocText}`;
    }

    const userMessagePayload = {
      role: 'user',
      content: userPrompt
    };
    if (processedImages.length > 0) {
      userMessagePayload.images = processedImages;
    }

    const ollamaPayload = {
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      options: { temperature: 0 },
      keep_alive: '30m',
      format: OLLAMA_CONTRACT_SCHEMA,
      messages: [
        { role: 'system', content: systemPrompt },
        userMessagePayload
      ]
    };

    let modelPlan = null;

    try {
      console.log(`[Ollama] Calling ${OLLAMA_HOST}/api/chat with model '${OLLAMA_MODEL}'...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaPayload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const rawContent = data.message?.content;
        if (rawContent) {
          const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          modelPlan = JSON.parse(cleaned);
        }
      } else {
        console.warn(`[Ollama Non-OK] Status: ${response.status}`);
      }
    } catch (ollamaErr) {
      console.warn(`[Ollama Error: ${ollamaErr.message}] - falling back to resilient rule-based navigator.`);
    }

    // If model failed, timed out, or Ollama is offline (e.g. on cloud host), use resilient fallback
    if (!modelPlan) {
      console.log('[Fallback] Using rule-based fallback routing.');
      modelPlan = fallbackPlan(situation, language);
    }

    // 6. Check if Model Detected Emergency
    if (modelPlan.emergency?.detected) {
      console.log('[SAFETY] Model flagged emergency = true.');
      return res.json(buildEmergencyResponse());
    }

    // 7. Check Doctor Search in Situation
    const matchedDoctorResult = findDoctorInMessage(situation);
    let primaryDept;
    let matchedDoctor = null;

    if (matchedDoctorResult) {
      console.log(`[Doctor Search] User matched doctor "${matchedDoctorResult.doctor.name}" in ${matchedDoctorResult.department.name}.`);
      primaryDept = matchedDoctorResult.department;
      matchedDoctor = formatDoctor(matchedDoctorResult.doctor);
    } else {
      primaryDept = findDept(modelPlan.department?.name);
    }

    // Build primary doctors list with matched doctor first
    let deptDoctors = (primaryDept.doctors || []).map(formatDoctor);
    if (matchedDoctor) {
      deptDoctors.sort((a, b) => (a.name === matchedDoctor.name ? -1 : b.name === matchedDoctor.name ? 1 : 0));
    }

    // 8. Process Related Departments
    const rawRelated = Array.isArray(modelPlan.relatedDepartments) ? modelPlan.relatedDepartments : [];
    const processedRelated = [];
    const seenDeptNames = new Set([norm(primaryDept.name)]);

    for (const relName of rawRelated) {
      const relDept = findDept(relName);
      const relNorm = norm(relDept.name);
      if (relDept && !seenDeptNames.has(relNorm)) {
        seenDeptNames.add(relNorm);
        processedRelated.push({
          name: relDept.name,
          doctors: (relDept.doctors || []).map(formatDoctor)
        });
      }
      if (processedRelated.length >= 2) break;
    }

    // 9. Format Final Response strictly conforming to OpenAPI CareCompassPlan
    const responsePlan = {
      emergency: {
        detected: false,
        message: null
      },
      department: {
        name: primaryDept.name,
        reason: matchedDoctor ? `Direct consultation requested for ${matchedDoctor.name}` : (modelPlan.department?.reason || `Consultation for ${primaryDept.name}`),
        urgency: ['routine', 'soon', 'urgent-seek-care-now'].includes(modelPlan.department?.urgency) ? modelPlan.department.urgency : 'routine'
      },
      extractedInformation: {
        medicines: Array.isArray(modelPlan.extractedInformation?.medicines) ? modelPlan.extractedInformation.medicines : [],
        dates: Array.isArray(modelPlan.extractedInformation?.dates) ? modelPlan.extractedInformation.dates : [],
        doctors: Array.isArray(modelPlan.extractedInformation?.doctors) ? modelPlan.extractedInformation.doctors : [],
        previousConditions: Array.isArray(modelPlan.extractedInformation?.previousConditions) ? modelPlan.extractedInformation.previousConditions : [],
        otherDetails: Array.isArray(modelPlan.extractedInformation?.otherDetails) ? modelPlan.extractedInformation.otherDetails : []
      },
      visitChecklist: Array.isArray(modelPlan.visitChecklist) && modelPlan.visitChecklist.length > 0 ? modelPlan.visitChecklist : [
        ...primaryDept.docs.map((d, idx) => ({ id: `doc-${idx}`, label: d, checked: false })),
        { id: 'base-id', label: 'Photo ID (Aadhaar, Voter ID, Passport or Driving License)', checked: false },
        { id: 'base-ins', label: 'Health insurance card / policy details or hospital card', checked: false },
        { id: 'base-meds', label: 'List of all current medications and allergies', checked: false }
      ],
      documentSummary: modelPlan.documentSummary || null,
      questionsToAskDoctor: Array.isArray(modelPlan.questionsToAskDoctor) && modelPlan.questionsToAskDoctor.length > 0 ? modelPlan.questionsToAskDoctor.slice(0, 7) : [
        'What are the next diagnostic tests or evaluations needed?',
        'Are there specific symptoms or changes I should watch out for?',
        'What lifestyle or daily routine adjustments should I follow?',
        'When should I schedule a follow-up review?',
        'Should I continue or pause any of my current supplements or medicines?'
      ],
      doctors: deptDoctors,
      relatedDepartments: processedRelated,
      matchedDoctor: matchedDoctor,
      dataNote: kb.data_note || 'Doctor details compiled from public hospital directories. They may be out of date. Confirm availability with the hospital.'
    };

    console.log(`[Success] Plan prepared: ${responsePlan.department.name} with ${responsePlan.doctors.length} doctors, ${responsePlan.relatedDepartments.length} related depts.`);
    return res.json(responsePlan);

  } catch (err) {
    console.error('[Handler Error]', err);
    return res.status(500).json({ error: err.message || 'An unexpected error occurred while preparing your visit plan.' });
  }
}

// Routes
app.get('/api/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ollama_host: OLLAMA_HOST,
    ollama_model: OLLAMA_MODEL,
    kb_departments: depts.map(d => d.name),
    data_note: kb.data_note
  });
});

app.post('/api/carecompass/navigate', handleNavigateRequest);

// Backward-compatibility route
app.post('/api/plan', (req, res) => {
  // Translate legacy format if needed
  if (!req.body.situation && req.body.message) {
    req.body.situation = req.body.message;
  }
  return handleNavigateRequest(req, res);
});

app.get('/api/departments', (req, res) => {
  res.json(depts);
});

// Fallback for SPA
app.get('*', (req, res) => {
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    res.json({ message: 'CareCompass API is running. Frontend dev server runs on Vite.' });
  }
});

// Pre-warm Ollama model in background on startup
function prewarmOllama() {
  console.log(`[Ollama] Warming up '${OLLAMA_MODEL}' at ${OLLAMA_HOST}...`);
  fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: 'Warmup ping' }],
      stream: false
    })
  })
  .then(res => {
    if (res.ok) console.log(`[Ollama] Model '${OLLAMA_MODEL}' pre-warmed successfully.`);
    else console.log(`[Ollama] Pre-warm ping returned status ${res.status}`);
  })
  .catch(err => {
    console.log(`[Ollama] Pre-warm note: Ollama not reachable at ${OLLAMA_HOST} (${err.message})`);
  });
}

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  CareCompass Server running at http://localhost:${PORT}`);
  console.log(`  Ollama endpoint: ${OLLAMA_HOST}/api/chat (Model: ${OLLAMA_MODEL})`);
  console.log(`  KB Departments: ${depts.length} with 50 doctors`);
  console.log(`====================================================`);
  prewarmOllama();
});
