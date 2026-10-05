# CareCompass: AI-Powered Patient Navigator

CareCompass is a patient-support and hospital navigation web application that assists users in identifying the appropriate medical department for their symptoms or documents, organizing their visit preparations, viewing specialist doctors across network hospitals, and locating nearby healthcare facilities using live OpenStreetMap (OSM) data.

> [!IMPORTANT]
> **Not Medical Advice**: CareCompass is a logistical navigation and information-organization tool. It does NOT provide medical diagnosis or treatment recommendations. In medical emergencies, always call emergency services (112 / 102 in India or your local emergency number) immediately.

---

## 🌟 Key Features

1. **Intelligent Department & Triage Guidance**
   - Ingests patient symptoms, queries, or uploaded medical documents (PDFs, PNG, JPG, GIF, WebP).
   - Powered by an in-house Ollama backend (`gemma4` / `llama3`) running locally for complete privacy.
   - Immediate deterministic emergency red-flag screening (e.g., chest pain, shortness of breath, stroke signs) before LLM invocation.

2. **Verified Hospital & Doctor Directory**
   - 50 real specialist profiles across major healthcare networks (Max Super Speciality, Fortis, Apollo, Medanta, AIIMS, etc.) across **Delhi**, **Gurugram**, and **Chennai**.
   - Direct "Open in Maps" links for exact hospital addresses.

3. **Interactive "Nearby Care" Live OSM Map**
   - **Zero API Keys**: Built with Leaflet, OpenStreetMap tiles, and Overpass API.
   - **Live OpenStreetMap Data**: Queries nearby hospitals and clinics around Delhi, Gurugram, and Chennai.
   - **Specialty Matching**: Tags facilities matching the selected medical department.
   - **Emergency Filter**: Instant toggle to show 24/7 emergency hospitals with verified emergency departments.
   - **Offline / Sample Data Fallback**: Automatically switches to the verified offline directory if network queries time out.
   - **Interactive Visit Checklist**: Save clinics/hospitals directly into your visit preparation plan and download a formatted PDF checklist.

4. **Privacy-First Architecture**
   - No patient data or medical documents are ever stored or logged.
   - Location queries to Overpass API are rounded to ~1 km for privacy and never tied to user identities.
   - In-memory processing only with fast local caching (`sessionStorage`).

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v20+ or v24+
- **pnpm**: `npm install -g pnpm`
- **Ollama**: (Optional for local AI generation) running at `http://localhost:11434` with model `gemma4`

### Installation
```powershell
# Install all dependencies across the workspace
pnpm install
```

### Running the Application

1. **Start the Ollama Backend Server** (port `3001`):
```powershell
node server.js
```

2. **Start the CareCompass Frontend** (port `5173`):
```powershell
pnpm --filter @workspace/carecompass run dev
```

3. Open your browser at:
- Local: `http://localhost:5173`
- Network (for mobile devices on same Wi-Fi): `http://<your-local-ip>:5173`

---

## 🧭 Project Structure

```
CareCompass-Patient-Navigator/
├── artifacts/
│   └── carecompass/               # React + Vite + Tailwind + shadcn/ui frontend
│       ├── src/
│       │   ├── components/
│       │   │   ├── nearby-care.tsx    # Live Leaflet Map & Hospital Directory component
│       │   │   ├── nearby-care.css    # Map styles & responsive layout
│       │   │   └── ui/               # shadcn UI components
│       │   ├── data/
│       │   │   └── hospitals.json    # Sample fallback healthcare facilities
│       │   ├── lib/
│       │   │   └── nearby-care.ts     # Overpass API live querying, haversine & caching
│       │   ├── App.tsx               # Main routing & application flow
│       │   └── main.tsx
│       └── vite.config.ts
├── hospital_kb.json               # 50 verified specialist doctors dataset
├── server.js                      # Express API server with Ollama integration
├── package.json
└── pnpm-workspace.yaml
```

---

## 🗺️ Nearby Care & OSM Integration

- **Primary Overpass Endpoint**: `https://overpass-api.de/api/interpreter`
- **Fallback Overpass Endpoint**: `https://overpass.kumi.systems/api/interpreter`
- **Caching**: 10-minute client-side `sessionStorage` cache per coordinates and radius to minimize network requests.
- **Privacy**: Coordinates are rounded to 2 decimal places before sending to OpenStreetMap Overpass servers.
