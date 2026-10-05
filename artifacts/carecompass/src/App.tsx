import { createContext, useContext, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateCareCompassPlan } from '@workspace/api-client-react';
import type { CareCompassDoctor, CareCompassPlan, CareCompassRequest, CareCompassRequestLanguage } from '@workspace/api-client-react';
import samplePrescriptionSvg from './sample-prescription.svg?raw';
import { ErrorBoundary } from '@/components/error-boundary';
import NearbyCare from '@/components/nearby-care';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { DepartmentId } from '@/lib/nearby-care';
import NotFound from '@/pages/not-found';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, Check,
  ChevronDown, CircleHelp, ClipboardCheck, Clock3, Copy, FileText, Globe, HeartPulse, Hospital,
  ListChecks, LockKeyhole, Menu, MessageCircle, Pill, Play, Printer, ShieldCheck, Sparkles,
  Stethoscope, Upload, UserRound, X, AlertTriangle, MapPin, ClipboardList, HeartHandshake,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const navItems = [
  { href: '/', label: 'Home' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/departments', label: 'Departments' },
  { href: '/nearby-care', label: 'Nearby Care' },
  { href: '/contact', label: 'Contact' },
];

const departments: { id: DepartmentId; name: string; detail: string; icon: typeof HeartPulse }[] = [
  { id: 'primary-care', name: 'General Medicine', detail: 'Primary care, fevers, routine checks, and overall health', icon: HeartPulse },
  { id: 'cardiology', name: 'Cardiology', detail: 'Heart, chest tightness, blood pressure, and circulation', icon: Activity },
  { id: 'orthopedics', name: 'Orthopaedics', detail: 'Bones, joints, fractures, spine, and movement', icon: Activity },
  { id: 'dermatology', name: 'Dermatology', detail: 'Skin rashes, acne, hair, nails, and allergies', icon: ShieldCheck },
  { id: 'gastroenterology', name: 'Gastroenterology', detail: 'Digestive health, stomach pain, liver, and acidity', icon: Activity },
  { id: 'ent', name: 'ENT', detail: 'Ear, nose, throat, sinuses, hearing, and tonsils', icon: UserRound },
  { id: 'ophthalmology', name: 'Ophthalmology', detail: 'Eye health, vision checks, cataracts, and irritation', icon: BadgeCheck },
  { id: 'pulmonology', name: 'Pulmonology', detail: 'Lungs, chronic cough, asthma, and breathing support', icon: Activity },
  { id: 'neurology', name: 'Neurology', detail: 'Brain, nerves, severe headaches, dizziness, and tremors', icon: Sparkles },
  { id: 'womens-health', name: 'Obstetrics and Gynaecology', detail: 'Women’s health, pregnancy, menstrual, and pelvic care', icon: HeartHandshake },
  { id: 'pediatrics', name: 'Pediatrics', detail: 'Care for infants, children and teens', icon: UserRound },
  { id: 'oncology', name: 'Oncology', detail: 'Cancer care and support services', icon: HeartHandshake },
  { id: 'imaging-diagnostics', name: 'Imaging & Diagnostics', detail: 'Imaging, labs and testing services', icon: ClipboardList },
];

const nearbyDepartmentOptions = departments.map(({ id, name }) => ({ id, name }));

const NearbyChecklistContext = createContext<{
  items: string[];
  addItem: (label: string) => void;
}>({ items: [], addItem: () => undefined });

function getDepartmentId(name: string): DepartmentId | 'all' {
  if (!name) return 'all';
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = departments.find(d => d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm);
  if (exact) return exact.id;

  const aliases: Record<string, DepartmentId> = {
    generalmedicine: 'primary-care',
    internalmedicine: 'primary-care',
    familymedicine: 'primary-care',
    primarycare: 'primary-care',
    cardiology: 'cardiology',
    orthopaedics: 'orthopedics',
    orthopedics: 'orthopedics',
    dermatology: 'dermatology',
    gastroenterology: 'gastroenterology',
    ent: 'ent',
    otolaryngology: 'ent',
    ophthalmology: 'ophthalmology',
    pulmonology: 'pulmonology',
    neurology: 'neurology',
    obstetricsandgynaecology: 'womens-health',
    obstetricsandgynecology: 'womens-health',
    obstetrics: 'womens-health',
    gynaecology: 'womens-health',
    gynecology: 'womens-health',
    womenshealth: 'womens-health',
    pediatrics: 'pediatrics',
    paediatrics: 'pediatrics',
    oncology: 'oncology',
    imaginganddiagnostics: 'imaging-diagnostics',
    imagingdiagnostics: 'imaging-diagnostics',
    radiology: 'imaging-diagnostics',
    diagnostics: 'imaging-diagnostics',
  };

  return aliases[norm] ?? 'all';
}

const faqs = [
  { q: 'Is CareCompass a medical or diagnostic tool?', a: 'No. CareCompass offers non-diagnostic hospital navigation support only. It helps you prepare for a hospital visit, organize documents, and know which department to approach.' },
  { q: 'What happens to the information I share?', a: 'Your request is processed securely in memory by the local AI engine. CareCompass does not save your health information or uploaded files. Nearby Care sends your approximate location (rounded to ~1 km) directly to OpenStreetMap Overpass without sending it to CareCompass servers.' },
  { q: 'Can CareCompass tell me which doctor to see?', a: 'It matches you with the relevant hospital department and displays verified specialists and OPD schedules from hospital directories.' },
  { q: 'Can I include a document or prescription?', a: 'Yes. You can paste text or attach a PDF or image (up to 7 MB). The tool will summarize key details and help you prepare questions.' },
  { q: 'What if I think this is an emergency?', a: 'Do not wait for CareCompass. If you experience chest pain, severe breathing difficulty, stroke signs, or profuse bleeding, immediately call 112 or visit the nearest emergency department.' },
  { q: 'Does it book appointments?', a: 'No. CareCompass helps you prepare for your OPD visit. Please contact the hospital OPD desk directly to confirm doctor availability and appointments.' },
];

function Logo() {
  return (
    <Link href="/" className="brand" aria-label="CareCompass home">
      <span className="brand-mark"><HeartPulse size={22} strokeWidth={2.4} /></span>
      <span>CareCompass</span>
    </Link>
  );
}

function Header() {
  const [path] = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <header className="nav-wrap">
      <div className="container navbar">
        <Logo />
        <nav className={`nav-links ${open ? 'open' : ''}`} aria-label="Main navigation">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={path === item.href ? 'active' : ''}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <Link href="/navigator" className="button button-primary">
            Start Navigating <ArrowRight size={16} />
          </Link>
          <button
            className="menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            data-testid="button-mobile-menu"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-main">
          <div>
            <Logo />
            <p className="footer-about">
              A little more clarity for your next hospital visit. Find services, gather your records, and feel prepared.
            </p>
          </div>
          <div className="footer-col">
            <h4>Explore</h4>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/departments">Departments</Link>
            <Link href="/nearby-care">Nearby Care</Link>
            <Link href="/faq">FAQs</Link>
          </div>
          <div className="footer-col">
            <h4>Get started</h4>
            <Link href="/navigator">Start navigating</Link>
            <Link href="/contact">Contact guidance</Link>
            <Link href="/">Home</Link>
          </div>
          <div className="footer-col">
            <h4>Here to guide, not diagnose</h4>
            <span>Use this tool to prepare for a conversation with your care team.</span>
          </div>
        </div>
        <div className="disclaimer">This tool provides navigation help only and is not medical advice.</div>
        <div className="footer-bottom">© 2026 CareCompass · Your care journey, a little clearer.</div>
      </div>
    </footer>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="site-shell"><Header />{children}<Footer /></div>;
}

function BrandSectionHeading({ label, title, copy }: { label: string; title: string; copy: string }) {
  return (
    <div className="section-heading">
      <span className="section-kicker">{label}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function DepartmentTiles({ count = 4 }: { count?: number }) {
  const photoPositions = ['center 24%', 'center 42%', 'center 72%', 'center 54%'];
  return (
    <div className="department-grid">
      {departments.slice(0, count).map((dept) => {
        const Icon = dept.icon;
        const index = departments.indexOf(dept);
        return (
          <Link href="/departments" key={dept.name} className="department-tile">
            <span className="department-tile-photo">
              <img src="/doctor-patient.jpg" alt="" style={{ objectPosition: photoPositions[index % photoPositions.length] }} />
              <span className="department-photo-icon"><Icon size={18} /></span>
              <span className="department-photo-label">
                <strong>{dept.name}</strong>
                <span>{dept.detail}</span>
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function StepsCards() {
  const steps = [
    { icon: MessageCircle, title: 'Tell us what’s on your mind', copy: 'Share what brings you in, and add a document if it helps. A few sentences are enough.' },
    { icon: MapPin, title: 'Find a place to start', copy: 'Get a suggested hospital service to contact and a simple explanation of why it may fit.' },
    { icon: ClipboardCheck, title: 'Feel ready for your visit', copy: 'Take a clear checklist and thoughtful questions to your conversation with a care team.' },
  ];
  return (
    <div className="steps-grid">
      {steps.map((step, i) => {
        const Icon = step.icon;
        return (
          <article className="step-card" key={step.title}>
            <span className="step-number">STEP 0{i + 1}</span>
            <span className="step-icon"><Icon size={24} /></span>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
          </article>
        );
      })}
    </div>
  );
}

function MiniPhone() {
  return (
    <div className="phone-wrap" aria-label="Preview of a CareCompass visit plan">
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-top"><span>9:41</span><span className="phone-brand">CareCompass</span><span>•••</span></div>
        <div className="phone-plan"><span className="phone-label">A place to start</span><b>General Medicine</b><p>A good first step to talk through your concerns with a care team.</p></div>
        <div className="phone-label">Your visit checklist</div>
        <div className="phone-tick"><i /> Bring your current medicines</div>
        <div className="phone-tick"><i /> Write down your questions</div>
        <div className="phone-tick"><i /> Bring relevant records</div>
        <div className="phone-line" /><div className="phone-line short" />
        <div className="phone-plan" style={{ marginTop: 14, background: '#f4f1ff' }}>
          <span className="phone-label" style={{ color: '#8170df' }}>Ready for your visit?</span>
          <p>Take this plan with you and share it with your care team.</p>
        </div>
      </div>
    </div>
  );
}

function FAQList({ limit }: { limit?: number }) {
  const [expanded, setExpanded] = useState<number | null>(0);
  return (
    <div className="faq-list">
      {faqs.slice(0, limit).map((faq, i) => (
        <div className="faq-item" key={faq.q}>
          <button
            className="faq-question"
            onClick={() => setExpanded(expanded === i ? null : i)}
            aria-expanded={expanded === i}
            data-testid={`button-faq-${i}`}
          >
            <span>{faq.q}</span>
            <ChevronDown size={18} style={{ transform: expanded === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          <div className="faq-answer" hidden={expanded !== i}>{faq.a}</div>
        </div>
      ))}
    </div>
  );
}

function Home() {
  const scrollDemo = () => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  return (
    <Shell>
      <main>
        <section className="container hero">
          <div className="hero-copy">
            <span className="eyebrow"><i className="eyebrow-dot" /> A clearer way to find care</span>
            <h1>Find the Right Care, <span>Without the Confusion</span></h1>
            <p>Hospital services can be hard to navigate. We’ll help you find a place to start and feel more ready for your visit.</p>
            <div className="hero-actions">
              <Link href="/navigator" className="button button-primary">Get Started <ArrowRight size={17} /></Link>
              <Link href="/nearby-care" className="button button-light">Nearby Care <MapPin size={16} /></Link>
              <button className="watch-link" onClick={scrollDemo}>
                <span className="play-circle"><Play size={14} fill="currentColor" /></span> Watch Demo
              </button>
            </div>
            <div className="hero-trust">
              <span className="avatar-stack"><i>AM</i><i>JL</i><i>RK</i></span>
              <span>Clear guidance, made with care</span>
              <ShieldCheck size={15} color="#39ad8f" />
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-photo-back" />
            <div className="hero-photo-frame">
              <img src="/doctor-patient.jpg" alt="A doctor listening attentively to a patient" />
            </div>
            <Sparkles className="hero-spark" size={28} />
            <div className="floating-card chat-float">
              <span className="float-icon"><MessageCircle size={19} /></span>
              <span><strong>A little more clarity</strong><small>One step at a time</small></span>
            </div>
            <div className="floating-card dept-float">
              <div className="dept-float-head">
                <span className="dept-bubble"><Hospital size={17} /></span>
                <span><small className="tiny-label">A place to start</small><span className="dept-result">General Medicine</span></span>
              </div>
              <div className="mini-progress"><i /></div>
            </div>
          </div>
        </section>
        <div className="container stats">
          <div className="stat"><strong>10</strong><span>specialty departments</span></div>
          <div className="stat"><strong>50</strong><span>verified hospital specialists</span></div>
          <div className="stat"><strong>OpenStreetMap</strong><span>live local provider search</span></div>
          <div className="stat"><strong>Always</strong><span>navigation, not diagnosis</span></div>
        </div>
        <section className="container section">
          <BrandSectionHeading label="A place to begin" title="Meet Our Departments" copy="A hospital has many doors. Explore common services and find a helpful starting point for your next conversation." />
          <DepartmentTiles />
        </section>
        <section className="steps-section" id="how-it-works">
          <div className="container">
            <BrandSectionHeading label="Simple by design" title="A little clarity goes a long way" copy="From what’s on your mind to a plan you can take along, we make the next step feel more manageable." />
            <StepsCards />
          </div>
        </section>
        <section className="container app-feature">
          <div className="feature-copy">
            <span className="section-kicker">Prepared, not overwhelmed</span>
            <h2>Your visit plan, all in one place</h2>
            <p>Get a calm, practical summary to help you organize your thoughts before you speak with a hospital care team.</p>
            <ul className="feature-list">
              <li><span className="check-dot"><Check size={15} /></span>A suggested department to contact</li>
              <li><span className="check-dot"><Check size={15} /></span>Verified specialists & OPD schedules</li>
              <li><span className="check-dot"><Check size={15} /></span>Live map of nearby clinics & hospitals</li>
              <li><span className="check-dot"><Check size={15} /></span>Questions to take to your appointment</li>
            </ul>
            <Link href="/navigator" className="button button-violet">Make your visit plan <ArrowRight size={16} /></Link>
          </div>
          <MiniPhone />
        </section>
        <section className="faq-section">
          <div className="container faq-layout">
            <div className="faq-intro">
              <span className="section-kicker">Good to know</span>
              <h2>Questions, answered</h2>
              <p>Care navigation should feel straightforward. Here are a few things to know before you get started.</p>
              <Link href="/faq" className="button button-light">See all FAQs <ArrowRight size={15} /></Link>
            </div>
            <FAQList limit={4} />
          </div>
        </section>
        <section className="container cta-band">
          <div className="cta-inner">
            <div>
              <h2>Let’s make your next step clearer.</h2>
              <p>Share what’s bringing you in. We’ll help you get organized.</p>
            </div>
            <Link href="/navigator" className="button button-primary">Start Navigating <ArrowRight size={16} /></Link>
          </div>
        </section>
      </main>
    </Shell>
  );
}

const suggestions = [
  'I have a skin rash for two weeks',
  'I feel breathless when climbing stairs',
  'Appointment with Dr. Praveen Chandra for chest tightness',
  'Severe ear pain and ringing for 3 days',
];
const acceptedMedia = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const emergencyPatterns = [
  /\bchest\s*pain\b/i, /\b(?:trouble|difficulty)\s+breathing\b/i,
  /\b(?:can'?t|cannot)\s+breathe\b/i, /\b(?:severe|heavy|profuse)\s+bleeding\b/i,
  /\b(?:face droop(?:ing)?|slurred speech|sudden weakness|stroke signs?)\b/i,
  /\b(?:unconscious|not waking up|severe allergic reaction|anaphylaxis)\b/i,
  /\b(?:ongoing|right now|currently)\s+seizure\b/i,
];

function hasEmergencySignal(text: string) {
  return emergencyPatterns.some(pattern => {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) return false;
    const precedingText = text.slice(Math.max(0, match.index - 40), match.index);
    return !/\b(?:no|not|denies?|denied|without|never|don't have|doesn't have|didn't have|free of)\b(?:\s+\w+){0,3}\s*$/i.test(precedingText);
  });
}

function getServerErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null;
  const data = (error as any).data;
  if (!data || typeof data !== 'object' || !('error' in data)) return null;
  return typeof data.error === 'string' ? data.error : null;
}

function createChecklistPdf(lines: string[]) {
  const safe = (line: string) => line.replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '\\$&').slice(0, 100);
  const textLines = lines.length ? lines : ['No checklist items were returned.'];
  const content = `BT /F1 16 Tf 54 748 Td (CareCompass visit checklist) Tj /F1 11 Tf 0 -28 Td ${textLines.map((line, index) => `${index ? '0 -22 Td ' : ''}(${safe(line)}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = 'carecompass-visit-checklist.pdf'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sampleSvgToPng(): Promise<File> {
  return new Promise((resolve, reject) => {
    const source = new Blob([samplePrescriptionSvg], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || 900;
      canvas.height = image.naturalHeight || 1160;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Image conversion is not available'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(objectUrl);
        if (!blob) {
          reject(new Error('Could not convert the sample image'));
          return;
        }
        resolve(new File([blob], 'sample-prescription.png', { type: 'image/png' }));
      }, 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load the sample image'));
    };
    image.src = objectUrl;
  });
}

function DoctorCard({ doc, isMatched }: { doc: CareCompassDoctor; isMatched?: boolean }) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${doc.hospital} ${doc.city}`)}`;
  return (
    <div className={`doctor-card ${isMatched ? 'is-matched' : ''}`}>
      <div className="doctor-card-top">
        <div>
          <div className="doctor-name-row">
            <h4 className="doctor-name">{doc.name}</h4>
            {isMatched && (
              <span className="matched-badge">
                <Check size={12} /> You searched for this doctor
              </span>
            )}
          </div>
          <span className="doctor-specialty">{doc.specialty}</span>
        </div>
      </div>
      <div className="doctor-meta-grid">
        <div className="meta-item">
          <MapPin size={14} className="meta-icon" />
          <span>
            <strong>{doc.hospital}</strong> · {doc.city}
            <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 7, color: '#1d6fe8', textDecoration: 'underline', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              Open in Maps <ArrowUpRight size={11} />
            </a>
          </span>
        </div>
        <div className="meta-item">
          <Stethoscope size={14} className="meta-icon" />
          <span>{doc.qualification} · <strong>{doc.experience}</strong></span>
        </div>
        <div className="meta-item">
          <UserRound size={14} className="meta-icon" />
          <span>{doc.languages.join(', ')}</span>
        </div>
        <div className="meta-item">
          <Clock3 size={14} className="meta-icon" />
          <span>{doc.timing}</span>
        </div>
        <div className="meta-item">
          <Hospital size={14} className="meta-icon" />
          <span>{doc.location}</span>
        </div>
      </div>
    </div>
  );
}

function Navigator() {
  const [situation, setSituation] = useState('');
  const [documentText, setDocumentText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [formError, setFormError] = useState('');
  const [language, setLanguage] = useState<CareCompassRequestLanguage>('English');
  const [plan, setPlan] = useState<CareCompassPlan | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedCity, setSelectedCity] = useState('All cities');
  const [isSlowLoading, setIsSlowLoading] = useState(false);

  const { items: nearbyChecklistItems, addItem: addNearbyChecklistItem } = useContext(NearbyChecklistContext);

  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = useCreateCareCompassPlan();
  const emergencySignal = hasEmergencySignal([situation, documentText].join(' '));

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (mutation.isPending) {
      setIsSlowLoading(false);
      timer = setTimeout(() => {
        setIsSlowLoading(true);
      }, 8000);
    } else {
      setIsSlowLoading(false);
    }
    return () => clearTimeout(timer);
  }, [mutation.isPending]);

  const addFile = (next: File | undefined) => {
    setFileError('');
    if (!next) return;
    if (!acceptedMedia.includes(next.type)) {
      setFileError('Choose a PDF or image file (JPEG, PNG, GIF, or WebP).');
      return;
    }
    if (next.size > 7_000_000) {
      setFileError('This file is too large. Choose a file under 7 MB.');
      return;
    }
    setFile(next);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => addFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFile(event.dataTransfer.files?.[0]);
  };

  const useSample = async () => {
    setFileError('');
    try {
      addFile(await sampleSvgToPng());
    } catch {
      setFileError('The sample image could not be prepared. Please choose another file.');
    }
  };

  const submit = async () => {
    setFormError('');
    if (situation.trim().length < 3) {
      setFormError('Please describe what help you need, using at least 3 characters.');
      return;
    }
    if (situation.trim().length > 3000) {
      setFormError('Please keep your situation under 3,000 characters.');
      return;
    }
    if (documentText.length > 12000) {
      setFormError('Please keep pasted document text under 12,000 characters.');
      return;
    }

    const request: CareCompassRequest = {
      situation: situation.trim(),
      language: language,
    };

    if (documentText.trim()) request.documentText = documentText.trim();

    if (file) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read file'));
          reader.onerror = () => reject(new Error('Could not read file'));
          reader.readAsDataURL(file);
        });
        request.documentBase64 = dataUrl.split(',')[1];
        request.fileName = file.name || (file.type === 'application/pdf' ? 'uploaded-document.pdf' : 'uploaded-document.png');
        request.mediaType = file.type as CareCompassRequest['mediaType'];
      } catch {
        setFormError('We couldn’t read that file. Please try another document.');
        return;
      }
    }

    mutation.mutate({ data: request }, {
      onSuccess: result => {
        setPlan(result);
        setSelectedCity('All cities');
        setCheckedItems(Object.fromEntries(result.visitChecklist.map(item => [item.id, item.checked])));
        window.setTimeout(() => document.getElementById('navigation-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      },
      onError: error => {
        setFormError(getServerErrorMessage(error) ?? 'We couldn’t prepare your plan just now. Please check your connection and try again.');
      },
    });
  };

  const startNew = () => {
    setPlan(null);
    setSituation('');
    setDocumentText('');
    setFile(null);
    setFileError('');
    setFormError('');
    setCheckedItems({});
    setSelectedCity('All cities');
    if (inputRef.current) inputRef.current.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const copyQuestions = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(plan.questionsToAskDoctor.map((question, i) => `${i + 1}. ${question}`).join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const deptUrgency = plan?.department.urgency ?? 'routine';

  // Primary doctors filtered by city
  const primaryDoctors = plan?.doctors || [];
  const filteredDoctors = selectedCity === 'All cities'
    ? primaryDoctors
    : primaryDoctors.filter(d => (d.city || '').toLowerCase() === selectedCity.toLowerCase());

  const visibleDoctors = filteredDoctors.slice(0, 3);
  const remainingDoctors = filteredDoctors.slice(3);

  const checklistPdfLines = () => plan ? [
    ...plan.visitChecklist.map(item => `${checkedItems[item.id] ? '[x]' : '[ ]'} ${item.label}`),
    ...nearbyChecklistItems.map((label, index) => `${checkedItems[`nearby-${index}`] ? '[x]' : '[ ]'} ${label}`),
  ] : [];

  return (
    <Shell>
      <main className="container navigator-wrap">
        <div className="navigator-heading">
          <span className="eyebrow"><i className="eyebrow-dot" /> Your next step, made clearer</span>
          <h1>Let’s find a place to start.</h1>
          <p>Tell us what brings you here. We’ll help organize a hospital navigation plan you can take to your care team.</p>
        </div>

        <section className="navigator-card" aria-label="Create a hospital navigation plan">
          <div className="privacy-note">
            <LockKeyhole size={15} /> CareCompass processes your request in-memory with a local privacy-preserving model. No personal health records are permanently stored.
          </div>

          {emergencySignal && (
            <div className="emergency-banner" role="alert" data-testid="status-emergency-guidance">
              <AlertTriangle size={21} />
              <div>
                <strong>Please seek emergency care now</strong>
                <p>If you may be experiencing an emergency (such as severe chest pain, shortness of breath, stroke signs, or profuse bleeding), call 112 or go to the nearest emergency department immediately. Do not wait for this tool.</p>
              </div>
            </div>
          )}

          <label className="field-label" htmlFor="situation">What would you like help navigating?</label>
          <textarea
            id="situation"
            className="situation-field"
            data-testid="input-situation"
            maxLength={3000}
            value={situation}
            onChange={e => setSituation(e.target.value)}
            placeholder="For example: I have a persistent skin rash on my arms for two weeks, or I want an appointment with Dr. Praveen Chandra."
          />
          <div className="field-help">{situation.length}/3,000 characters. Share only what you’re comfortable sharing.</div>

          <div className="suggestions">
            {suggestions.map(chip => (
              <button
                key={chip}
                type="button"
                className="suggestion"
                data-testid={`button-suggestion-${suggestions.indexOf(chip)}`}
                onClick={() => setSituation(chip)}
              >
                {chip}
              </button>
            ))}
          </div>

          <label className="field-label">Add a document <span style={{ color: '#9ba3b2', fontWeight: 400 }}>(optional)</span></label>
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="upload-icon"><Upload size={20} /></span>
            <div className="upload-text">
              <strong>Drop a file here or browse</strong>
              <span>PDF, JPEG, PNG, GIF or WebP · up to 7 MB</span>
            </div>
            <div className="upload-controls">
              <button type="button" className="upload-button" onClick={() => inputRef.current?.click()} data-testid="button-upload">
                Choose file
              </button>
              {!file && (
                <>
                  <button type="button" className="upload-button" onClick={useSample} data-testid="button-use-sample">
                    Use sample image
                  </button>
                  <a href="/sample-prescription.svg" className="upload-button" target="_blank" rel="noreferrer">
                    View sample
                  </a>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".pdf,image/jpeg,image/png,image/gif,image/webp"
              onChange={onFileChange}
              data-testid="input-file"
            />
          </div>

          {file && (
            <div className="file-name" data-testid="text-selected-file">
              <span>
                <FileText size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                className="remove-file"
                onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}
                data-testid="button-remove-file"
              >
                Remove
              </button>
            </div>
          )}

          {fileError && <div className="form-error" role="alert">{fileError}</div>}

          <label className="field-label" htmlFor="document-text" style={{ marginTop: 22 }}>
            Or paste text from a record <span style={{ color: '#9ba3b2', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            id="document-text"
            className="document-input"
            maxLength={12000}
            value={documentText}
            onChange={e => setDocumentText(e.target.value)}
            placeholder="Paste text from a prescription, discharge summary, or lab report."
            data-testid="input-document-text"
          />
          <div className="field-help">{documentText.length}/12,000 characters.</div>

          <div className="navigator-form-footer">
            <div className="language-select-wrap">
              <label htmlFor="language-select" className="lang-label">
                <Globe size={15} /> Language:
              </label>
              <select
                id="language-select"
                className="language-select"
                value={language}
                onChange={e => setLanguage(e.target.value as CareCompassRequestLanguage)}
              >
                <option value="English">English</option>
                <option value="Tamil">தமிழ் (Tamil)</option>
                <option value="Hindi">हिन्दी (Hindi)</option>
              </select>
            </div>

            <button
              className="button button-primary navigator-submit"
              type="button"
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="button-create-plan"
            >
              {mutation.isPending ? (
                <>Preparing your plan <span className="loading-dots">···</span></>
              ) : (
                <>Create my navigation plan <ArrowRight size={17} /></>
              )}
            </button>
          </div>

          {formError && <div className="form-error" role="alert" data-testid="status-request-error">{formError}</div>}

          {mutation.isPending && (
            <div className="loading-card" role="status">
              <div className="progress-head">
                Putting your details in order
                <span>Analyzing symptoms, matching hospital KB, and preparing specialist options.</span>
              </div>
              {isSlowLoading && (
                <div className="slow-warning-banner">
                  <Clock3 size={16} />
                  <span>The local AI model is generating your structured visit plan. This usually takes 10-20 seconds on first run...</span>
                </div>
              )}
              <div className="loading-steps">
                <div className="loading-step"><i /> Reading your request</div>
                <div className="loading-step"><i /> Matching department & specialists</div>
                <div className="loading-step"><i /> Preparing visit checklist</div>
              </div>
              <div className="skeleton-line wide" />
              <div className="skeleton-line short" />
            </div>
          )}
        </section>

        {plan && (
          <section className="result-area" id="navigation-result" aria-live="polite">
            <div className="result-toolbar">
              <h2>Your navigation plan</h2>
              <div className="toolbar-actions">
                {!plan.emergency.detected && (
                  <button
                    className="small-action"
                    onClick={() => createChecklistPdf(checklistPdfLines())}
                    data-testid="button-download-checklist"
                  >
                    <ArrowDownToLine size={15} /> Download checklist as PDF
                  </button>
                )}
                <button className="small-action" onClick={() => window.print()} data-testid="button-print-plan">
                  <Printer size={15} /> Print
                </button>
                <button className="small-action" onClick={startNew} data-testid="button-start-new">
                  <X size={15} /> Start new query
                </button>
              </div>
            </div>

            {plan.emergency.detected ? (
              <>
                <div className="emergency-banner" role="alert">
                  <AlertTriangle size={24} />
                  <div>
                    <strong>Please seek immediate emergency care</strong>
                    <p>{plan.emergency.message || 'Call 112 (or your local emergency number) or go to the nearest emergency department right away.'}</p>
                  </div>
                </div>

                <NearbyCare
                  departments={nearbyDepartmentOptions}
                  initialDepartmentId="all"
                  emergency
                  expandedByDefault
                  onAddToChecklist={addNearbyChecklistItem}
                />
              </>
            ) : (
              <>
                <div className="result-grid">
                  {/* Department Card */}
                  <article className="result-card">
                    <div className="result-card-head">
                      <span className="result-icon"><Hospital size={19} /></span>
                      <h3>A place to start</h3>
                    </div>
                    <span className={`urgency-pill ${deptUrgency}`}>
                      <Clock3 size={13} /> {deptUrgency === 'urgent-seek-care-now' ? 'Seek care now' : deptUrgency === 'soon' ? 'Consider soon' : 'Routine navigation'}
                    </span>
                    <h3 style={{ fontSize: 18, color: '#343a58', margin: '12px 0 0' }}>{plan.department.name}</h3>
                    <p className="result-copy">{plan.department.reason}</p>
                  </article>

                  {/* Extracted Document Info Card */}
                  <article className="result-card">
                    <div className="result-card-head">
                      <span className="result-icon"><ListChecks size={19} /></span>
                      <h3>Information to bring up</h3>
                    </div>
                    <div className="fact-list">
                      {plan.extractedInformation.medicines.length > 0 && (
                        <div className="fact-row">
                          <b><Pill size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Medicines mentioned</b>
                          <span>{plan.extractedInformation.medicines.map(m => [m.name, m.dosage, m.instructions].filter(Boolean).join(' · ')).join('; ')}</span>
                        </div>
                      )}
                      {plan.extractedInformation.dates.length > 0 && (
                        <div className="fact-row">
                          <b>Dates</b>
                          <span>{plan.extractedInformation.dates.join(' · ')}</span>
                        </div>
                      )}
                      {plan.extractedInformation.doctors.length > 0 && (
                        <div className="fact-row">
                          <b>Doctors named in your document</b>
                          <span>{plan.extractedInformation.doctors.join(' · ')}</span>
                        </div>
                      )}
                      {plan.extractedInformation.previousConditions.length > 0 && (
                        <div className="fact-row">
                          <b>Previous conditions mentioned</b>
                          <span>{plan.extractedInformation.previousConditions.join(' · ')}</span>
                        </div>
                      )}
                      {plan.extractedInformation.otherDetails.length > 0 && (
                        <div className="fact-row">
                          <b>Other details</b>
                          <span>{plan.extractedInformation.otherDetails.join(' · ')}</span>
                        </div>
                      )}
                      {!plan.extractedInformation.medicines.length && !plan.extractedInformation.dates.length && !plan.extractedInformation.doctors.length && !plan.extractedInformation.previousConditions.length && !plan.extractedInformation.otherDetails.length && (
                        <p className="result-copy" style={{ margin: 0 }}>No specific details were extracted. You can still share anything important with your care team.</p>
                      )}
                    </div>
                  </article>

                  {/* Primary Department Doctors Card */}
                  {primaryDoctors.length > 0 && (
                    <article className="result-card wide">
                      <div className="result-card-head" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="result-icon"><Stethoscope size={19} /></span>
                          <h3>Doctors in {plan.department.name}</h3>
                        </div>
                        <div className="city-filters">
                          {['All cities', 'Delhi', 'Gurugram', 'Chennai'].map(city => (
                            <button
                              key={city}
                              type="button"
                              className={`city-pill ${selectedCity === city ? 'active' : ''}`}
                              onClick={() => setSelectedCity(city)}
                            >
                              {city}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="doctors-list">
                        {visibleDoctors.length > 0 ? (
                          visibleDoctors.map(doc => (
                            <DoctorCard
                              key={`${doc.name}-${doc.hospital}`}
                              doc={doc}
                              isMatched={Boolean(plan.matchedDoctor && plan.matchedDoctor.name === doc.name)}
                            />
                          ))
                        ) : (
                          <p className="result-copy">No doctors found in {selectedCity} for this department.</p>
                        )}

                        {remainingDoctors.length > 0 && (
                          <details className="doctors-expand">
                            <summary className="doctors-summary">
                              Show all {filteredDoctors.length} doctors ({remainingDoctors.length} more)
                            </summary>
                            <div className="doctors-expanded-list">
                              {remainingDoctors.map(doc => (
                                <DoctorCard
                                  key={`${doc.name}-${doc.hospital}`}
                                  doc={doc}
                                  isMatched={Boolean(plan.matchedDoctor && plan.matchedDoctor.name === doc.name)}
                                />
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </article>
                  )}

                  {/* Related Departments Card */}
                  {plan.relatedDepartments && plan.relatedDepartments.length > 0 && (
                    <details className="result-card wide related-depts-card">
                      <summary className="related-depts-summary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="result-icon"><Hospital size={19} /></span>
                          <h3>Other departments that may help ({plan.relatedDepartments.length})</h3>
                        </div>
                        <ChevronDown size={18} className="related-chevron" />
                      </summary>
                      <div className="related-depts-content">
                        {plan.relatedDepartments.map(rel => (
                          <div key={rel.name} className="related-dept-block">
                            <h4 className="related-dept-title">{rel.name}</h4>
                            <div className="doctors-list">
                              {rel.doctors.slice(0, 3).map(doc => (
                                <DoctorCard key={`${doc.name}-${doc.hospital}`} doc={doc} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Visit Checklist */}
                  <article className="result-card">
                    <div className="result-card-head">
                      <span className="result-icon"><ClipboardCheck size={19} /></span>
                      <h3>Your visit checklist</h3>
                    </div>
                    <div className="checklist">
                      {plan.visitChecklist.map(item => (
                        <label className="check-item" key={item.id}>
                          <input
                            type="checkbox"
                            checked={checkedItems[item.id] ?? item.checked}
                            onChange={e => setCheckedItems({ ...checkedItems, [item.id]: e.target.checked })}
                            data-testid={`checkbox-checklist-${item.id}`}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                      {nearbyChecklistItems.map((label, index) => (
                        <label className="check-item" key={`nearby-${label}`}>
                          <input
                            type="checkbox"
                            checked={checkedItems[`nearby-${index}`] ?? false}
                            onChange={e => setCheckedItems({ ...checkedItems, [`nearby-${index}`]: e.target.checked })}
                            data-testid={`checkbox-nearby-checklist-${index}`}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </article>

                  {/* Plain language summary */}
                  <article className="result-card">
                    <div className="result-card-head">
                      <span className="result-icon"><FileText size={19} /></span>
                      <h3>In plain language</h3>
                    </div>
                    {plan.documentSummary ? (
                      <p className="summary-box">{plan.documentSummary}</p>
                    ) : (
                      <p className="result-copy" style={{ margin: 0 }}>
                        No document summary was returned. You can still bring your own records and ask your care team to walk through them with you.
                      </p>
                    )}
                  </article>

                  {/* Questions for doctor */}
                  <article className="result-card wide">
                    <div className="result-card-head">
                      <span className="result-icon"><CircleHelp size={19} /></span>
                      <h3>Questions to ask your doctor</h3>
                      <button className="small-action" style={{ marginLeft: 'auto' }} onClick={copyQuestions} data-testid="button-copy-questions">
                        <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <ol className="questions-list">
                      {plan.questionsToAskDoctor.map((question, index) => (
                        <li key={`${question}-${index}`}>{question}</li>
                      ))}
                    </ol>
                  </article>
                </div>

                {/* Nearby Care Map Section in Results */}
                <NearbyCare
                  departments={nearbyDepartmentOptions}
                  initialDepartmentId={getDepartmentId(plan.department.name)}
                  emergency={deptUrgency === 'urgent-seek-care-now' || emergencySignal}
                  onAddToChecklist={addNearbyChecklistItem}
                />
              </>
            )}

            <p className="field-help" style={{ textAlign: 'center', marginTop: 22, color: '#8893a7', lineHeight: 1.6 }}>
              {plan.dataNote || 'Doctor details compiled from public hospital directories. They may be out of date. Confirm availability with the hospital.'}
              <br />
              This tool provides navigation help only and is not medical advice.
            </p>
          </section>
        )}
      </main>
    </Shell>
  );
}

function PageHero({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return (
    <section className="page-hero container">
      <span className="eyebrow"><i className="eyebrow-dot" /> {kicker}</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </section>
  );
}

function DepartmentsPage() {
  return (
    <Shell>
      <main>
        <PageHero
          kicker="Explore services"
          title="Find your way around hospital care."
          copy="Learn a little about common hospital departments. If you’re unsure where to begin, CareCompass can help you prepare a starting point for a conversation."
        />
        <div className="container department-page-grid">
          {departments.map(dept => {
            const Icon = dept.icon;
            return (
              <article className="department-page-card" key={dept.name}>
                <span className="department-icon"><Icon size={22} /></span>
                <h3>{dept.name}</h3>
                <p>{dept.detail}. Contact your hospital directly to ask about services, availability, and appointments.</p>
              </article>
            );
          })}
        </div>
      </main>
    </Shell>
  );
}

function NearbyCarePage() {
  const { addItem } = useContext(NearbyChecklistContext);
  return (
    <Shell>
      <main>
        <PageHero
          kicker="Care close to you"
          title="Find nearby clinics and hospitals."
          copy="Choose a department and an area to explore live local medical providers on OpenStreetMap."
        />
        <div className="container" style={{ paddingBottom: 80 }}>
          <NearbyCare
            departments={nearbyDepartmentOptions}
            initialDepartmentId="all"
            expandedByDefault
            onAddToChecklist={addItem}
          />
        </div>
      </main>
    </Shell>
  );
}

function HowPage() {
  const rows = [
    { title: 'Share what brings you here', copy: 'Write a few words about what you’re trying to navigate. You can also attach a record or paste text if you want help gathering the details already written there.', icon: MessageCircle },
    { title: 'Get a place to start', copy: 'CareCompass organizes your request into a suggested hospital service, relevant details, and a checklist. It is a guide for your conversation, not a clinical opinion.', icon: Hospital },
    { title: 'Take your plan to your care team', copy: 'Bring your checklist and questions to the hospital. Your clinician is the right person to discuss symptoms, records, and care decisions with you.', icon: ClipboardCheck },
  ];
  return (
    <Shell>
      <main>
        <PageHero
          kicker="A simple path forward"
          title="Three steps to a more prepared visit."
          copy="CareCompass helps you gather your thoughts and find a hospital service to contact—without trying to make medical decisions for you."
        />
        <section className="container how-detail">
          {rows.map((row, i) => {
            const Icon = row.icon;
            return (
              <article className="how-row" key={row.title}>
                <span className="big-number">0{i + 1}</span>
                <div>
                  <h2>{row.title}</h2>
                  <p>{row.copy}</p>
                </div>
                <div className="how-illustration"><Icon size={40} strokeWidth={1.6} /></div>
              </article>
            );
          })}
          <div style={{ textAlign: 'center', paddingTop: 35 }}>
            <Link href="/navigator" className="button button-primary">Start navigating <ArrowRight size={16} /></Link>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function FAQPage() {
  return (
    <Shell>
      <main>
        <PageHero
          kicker="A few helpful answers"
          title="Good questions. Clear answers."
          copy="Learn what CareCompass can help with, how your request is handled, and when to reach out to a care professional directly."
        />
        <section className="container faq-page"><FAQList /></section>
      </main>
    </Shell>
  );
}

function ContactPage() {
  return (
    <Shell>
      <main>
        <PageHero
          kicker="Need a hand?"
          title="The right contact for the right question."
          copy="CareCompass is a self-guided navigation tool. For hospital-specific, appointment, or clinical questions, your hospital team can help."
        />
        <section className="contact-card">
          <article className="contact-panel">
            <span className="department-icon"><Hospital size={21} /></span>
            <h3>Finding a hospital service</h3>
            <p>Call the main number on your hospital’s website and ask to be directed to the department or patient navigation team.</p>
          </article>
          <article className="contact-panel">
            <span className="department-icon"><CalendarDays size={21} /></span>
            <h3>Appointments or records</h3>
            <p>Contact the hospital’s scheduling desk or medical records office. They can confirm availability and explain their process.</p>
          </article>
          <article className="contact-panel">
            <span className="department-icon"><Stethoscope size={21} /></span>
            <h3>Questions about your health</h3>
            <p>Speak with your doctor or care team. CareCompass cannot assess symptoms, answer clinical questions, or replace medical advice.</p>
          </article>
          <article className="contact-panel">
            <span className="department-icon"><HeartHandshake size={21} /></span>
            <h3>Emotional support</h3>
            <p>If you feel overwhelmed, ask your hospital about a patient advocate, social worker, interpreter, or support person.</p>
          </article>
          <div className="contact-note">
            <strong>If you may be having an emergency:</strong> contact your local emergency number or go to the nearest emergency department now. Do not use this website to seek emergency help.
          </div>
        </section>
      </main>
    </Shell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/navigator" component={Navigator} />
      <Route path="/how-it-works" component={HowPage} />
      <Route path="/departments" component={DepartmentsPage} />
      <Route path="/nearby-care" component={NearbyCarePage} />
      <Route path="/faq" component={FAQPage} />
      <Route path="/contact" component={ContactPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const [nearbyChecklistItems, setNearbyChecklistItems] = useState<string[]>([]);
  const addNearbyChecklistItem = (label: string) => {
    setNearbyChecklistItems(items => items.includes(label) ? items : [...items, label]);
  };

  return (
    <NearbyChecklistContext.Provider value={{ items: nearbyChecklistItems, addItem: addNearbyChecklistItem }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <RoutedErrorBoundary>
              <Router />
            </RoutedErrorBoundary>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </NearbyChecklistContext.Provider>
  );
}

export default App;
