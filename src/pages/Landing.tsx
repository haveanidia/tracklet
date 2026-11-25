import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/ui/Icon';

const HOME_URL = '/home.html';

function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`ld-reveal ${inView ? 'is-in' : ''} ${className}`}
      style={{ ['--ld-delay' as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--color-ink)" stroke="var(--color-line-strong)" />
      <path
        d="M6 24c4-12 8-15 11-12s3 9 5 11 4-3 4-3"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="10" cy="16" r="3" fill="var(--color-ink)" stroke="var(--color-accent)" strokeWidth="2" />
    </svg>
  );
}

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Tracking', href: '#tracking' },
  { label: 'Stabilization', href: '#stabilization' },
  { label: 'Documentation', href: '#workflow' },
];

/** Real editor captures, framed like app windows. All shots are 8:5. */
function Shot({
  src,
  alt,
  title,
  meta,
  eager = false,
}: {
  src: string;
  alt: string;
  /** Shown in a window title bar; omit for inline feature shots. */
  title?: string;
  meta?: string;
  eager?: boolean;
}) {
  return (
    <figure className="overflow-hidden rounded-[10px] border border-line bg-panel shadow-[0_24px_60px_-18px_rgba(0,0,0,0.7)]">
      {title && (
        <div className="flex h-8 items-center gap-2 border-b border-line bg-panel-2 px-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-[9px] w-[9px] rounded-full bg-danger/80" />
            <span className="h-[9px] w-[9px] rounded-full bg-warn/80" />
            <span className="h-[9px] w-[9px] rounded-full bg-ok/80" />
          </div>
          <span className="min-w-0 flex-1 truncate text-center text-[10.5px] text-fg-muted">{title}</span>
          {meta && <span className="field-mono hidden shrink-0 text-[9px] text-fg-muted sm:block">{meta}</span>}
        </div>
      )}
      <img
        src={src}
        alt={alt}
        width={2400}
        height={1500}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="block w-full bg-viewer"
      />
    </figure>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <div
        className={`mx-auto max-w-6xl rounded-[10px] border transition-all duration-200 ${
          scrolled
            ? 'border-line-strong bg-panel/92 shadow-[0_12px_36px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="flex h-11 items-center justify-between gap-2 pl-3 pr-2">
          <a href="/" className="flex shrink-0 items-center gap-2 text-[12.5px] font-semibold text-fg">
            <LogoMark size={19} />
            Tracklet
          </a>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-[6px] px-2.5 py-1.5 text-[11.5px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <a href={HOME_URL} className="btn hidden h-7 text-[11.5px] sm:inline-flex">
              Open Editor
            </a>
            <a href={HOME_URL} className="btn btn-primary h-7 text-[11.5px]">
              Launch Tracklet
            </a>
            <button
              className="icon-btn ml-0.5 md:hidden"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name={open ? 'close' : 'menu'} size={15} />
            </button>
          </div>
        </div>
        {open && (
          <div className="float-in border-t border-line p-2 md:hidden">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-[6px] px-3 py-2 text-[12.5px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
              >
                {link.label}
              </a>
            ))}
            <a href={HOME_URL} className="btn btn-primary mt-1 h-8 w-full text-[12px]">
              Launch Tracklet
            </a>
          </div>
        )}
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-32 sm:pb-24 sm:pt-40">
      <div className="ld-hero-bg absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-5">
        <Reveal>
          <h1 className="max-w-3xl text-[38px] font-semibold leading-[1.06] tracking-[-0.03em] text-fg sm:text-5xl lg:text-[58px]">
            Motion tracking.
            <br />
            <span className="text-fg-dim">Without the editing suite.</span>
          </h1>
        </Reveal>
        <Reveal delay={90}>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-fg-dim">
            Track objects, stabilize footage, and attach motion to anything in your frame — inside a lightweight
            video workspace that runs entirely on your machine.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={HOME_URL} className="btn btn-primary h-10 px-5 text-[13.5px]">
              <Icon name="play" size={13} /> Open Tracklet
            </a>
            <a href="#features" className="btn h-10 px-5 text-[13.5px]">
              Explore tracking
            </a>
          </div>
        </Reveal>
        <Reveal delay={260}>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-fg-muted">
            {['Runs locally — browser or desktop', 'Nothing is uploaded', 'H.264 + WebM export'].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="text-fg-dim" /> {item}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <Reveal>
      <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-fg sm:text-[30px]">{title}</h2>
      {sub && <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-fg-dim">{sub}</p>}
    </Reveal>
  );
}

function FeatureRow({
  id,
  title,
  body,
  scene,
  flip,
  detail,
}: {
  id?: string;
  title: string;
  body: string;
  scene: ReactNode;
  flip?: boolean;
  detail?: ReactNode;
}) {
  return (
    <div id={id} className="grid items-center gap-8 scroll-mt-28 lg:grid-cols-2 lg:gap-14">
      <Reveal className={flip ? 'lg:order-2' : ''}>{scene}</Reveal>
      <Reveal delay={120} className={flip ? 'lg:order-1' : ''}>
        <h3 className="text-[20px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-fg-dim">{body}</p>
        {detail && <div className="mt-5">{detail}</div>}
      </Reveal>
    </div>
  );
}

const kbdKeys: [string, string][] = [
  ['P', 'Point'],
  ['R', 'Region'],
  ['G', 'Planar'],
];

function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-line py-20 sm:py-24">
      <div className="mx-auto max-w-6xl space-y-20 px-5 sm:space-y-24">
        <SectionHead
          title="One workspace for the whole motion pipeline"
          sub="Point, region and planar tracking — plus the stabilizers that turn raw data into finished frames. No project files, no plugin hosts, no render queue."
        />
        <FeatureRow
          id="tracking"
          title="Point tracking"
          body="Click any high-contrast feature and Lucas–Kanade optical flow follows it frame by frame. Region and planar modes track boxes and full surfaces with perspective."
          scene={
            <Shot
              src="/assets/shots/step-select.png"
              alt="A point placed on a hot-air balloon in the Tracklet viewer, with the starting keyframe and Track forward controls in the inspector."
            />
          }
          detail={
            <div className="flex items-center gap-2">
              {kbdKeys.map(([key, label]) => (
                <span key={key} className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                  <span className="kbd">{key}</span> {label}
                </span>
              ))}
            </div>
          }
        />
        <FeatureRow
          id="stabilization"
          flip
          title="Subject Lock"
          body="Keep a tracked object at a fixed position while everything else moves around it. Adaptive zoom fills the frame without over-cropping."
          scene={
            <Shot
              src="/assets/shots/subject-lock.png"
              alt="Subject Lock holding the tracked balloon on the anchor at the centre of the frame, with the balloon's motion path and the stabilization controls beside it."
            />
          }
        />
        <FeatureRow
          flip
          title="Smooth Camera"
          body="Reduce handheld shake while preserving natural movement. The result is a calm, deliberate take — compare original and stabilized side by side in the preview."
          scene={
            <Shot
              src="/assets/shots/smooth-camera.png"
              alt="A/B split of a shaky handheld shot: the original half and the stabilized half meet at the seam, where the frame has been shifted to cancel the shake."
            />
          }
        />
        <FeatureRow
          title="Motion attachment"
          body="Attach text, images or shapes to tracked motion and they move with it — perfectly in sync, frame for frame, all the way to export."
          scene={
            <Shot
              src="/assets/shots/step-overlay.png"
              alt="A text overlay reading BALLOON 01 pinned above the tracked balloon, with its placement offsets in the inspector."
            />
          }
          flip
        />
      </div>
    </section>
  );
}

const workflowSteps = [
  {
    number: '01',
    title: 'Select',
    body: 'Import your footage and pick a point or object. The workspace probes duration and frame rate for frame-accurate positioning.',
    demo: (
      <Shot
        src="/assets/shots/step-import.png"
        alt="The empty Tracklet editor with a large drop zone and an Import video button."
      />
    ),
  },
  {
    number: '02',
    title: 'Track',
    body: 'Track movement across frames in either direction. Every frame stays a keyframe you can correct by hand.',
    demo: (
      <Shot
        src="/assets/shots/step-select.png"
        alt="A point keyframed on the balloon at frame zero, with Track forward in the inspector."
      />
    ),
  },
  {
    number: '03',
    title: 'Apply',
    body: 'Stabilize footage, attach graphics, or export the raw motion data in the format your pipeline expects.',
    demo: (
      <Shot
        src="/assets/shots/export-dialog.png"
        alt="The Export dialog offering JSON, CSV, SVG motion paths, an After Effects script and a rendered video."
      />
    ),
  },
];

function Workflow() {
  return (
    <section id="workflow" className="scroll-mt-20 border-t border-line py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead
          title="Three steps from footage to motion"
          sub="Everything happens on your machine. These are real captures from the editor, start to finish."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {workflowSteps.map((step, i) => (
            <Reveal key={step.number} delay={i * 110}>
              <div className="flex h-full flex-col rounded-[10px] border border-line bg-panel p-5 transition-colors duration-200 hover:bg-panel-2">
                <div className="flex items-baseline gap-3">
                  <span className="field-mono text-[11px] text-accent">{step.number}</span>
                  <h3 className="text-[15px] font-semibold text-fg">{step.title}</h3>
                </div>
                <p className="mb-4 mt-2 text-[12.5px] leading-relaxed text-fg-muted">{step.body}</p>
                <div className="mt-auto">{step.demo}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const capabilities: { title: string; body: string; visual: ReactNode }[] = [
  {
    title: 'Manual corrections',
    body: 'Drag any tracked frame to correct it; the fix propagates as a keyframe.',
    visual: (
      <div className="flex items-center gap-1">
        {[12, 28, 46, 64].map((left, i) => (
          <span
            key={left}
            className="keyframe h-[7px] w-[7px] rotate-45 bg-accent"
            style={{ marginLeft: `${left}%` }}
            data-current={i === 2 ? 'true' : undefined}
          />
        ))}
      </div>
    ),
  },
  {
    title: 'Motion paths',
    body: 'The travelled path of every visible object, drawn on the picture.',
    visual: (
      <svg width="72" height="28" viewBox="0 0 72 28" aria-hidden="true">
        <path d="M4 22 C 22 20, 36 14, 50 8 S 66 4, 68 4" fill="none" stroke="var(--color-accent)" strokeWidth="1.3" strokeDasharray="3 3" opacity="0.7" />
        <circle cx="68" cy="4" r="2.2" fill="var(--color-accent)" />
      </svg>
    ),
  },
  {
    title: 'Adaptive zoom',
    body: 'Crop-aware zoom keeps the stabilized frame full without over-cropping.',
    visual: (
      <div className="flex items-center gap-2">
        <div className="relative h-6 w-6 rounded-full border border-line-strong">
          <div className="absolute inset-1.5 rounded-full border border-accent-line" />
        </div>
        <span className="chip">104% zoom</span>
      </div>
    ),
  },
  {
    title: 'Tracking confidence',
    body: 'Frames below threshold hold the last reliable lock instead of jumping.',
    visual: (
      <div className="flex items-end gap-1.5">
        {[92, 74, 41].map((v, i) => (
          <div key={v} className="relative h-7 w-3 overflow-hidden rounded-[2px] bg-sunken">
            <div
              className="absolute bottom-0 w-full rounded-[2px]"
              style={{
                height: `${v}%`,
                background: i === 2 ? 'var(--color-warn)' : 'var(--color-accent)',
                opacity: 0.85,
              }}
            />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Keyframe editing',
    body: 'Correcting a frame creates or overwrites its key. Every edit is undoable.',
    visual: (
      <div className="flex items-center gap-2">
        <span className="chip">90 keys</span>
        <span className="chip chip-accent">undoable</span>
      </div>
    ),
  },
  {
    title: 'After Effects',
    body: 'A .jsx export drops null layers and keyframes straight into your comp.',
    visual: (
      <div className="flex items-center gap-2">
        <span className="chip">null layers</span>
        <span className="chip">keyframes</span>
      </div>
    ),
  },
];

function Showcase() {
  return (
    <section className="border-t border-line py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead
          title="Built for the details that matter"
          sub="The pipeline is exposed, not hidden. What you see in the editor is what you export."
        />
        <Reveal delay={120}>
          <div className="mt-12 overflow-hidden rounded-[10px] border border-line bg-panel">
            <div className="grid md:grid-cols-2">
              {capabilities.map((item, i) => (
                <div
                  key={item.title}
                  className={`group flex items-center justify-between gap-5 p-5 transition-colors duration-200 hover:bg-hover sm:p-6 ${
                    i > 0 ? 'border-t border-line' : ''
                  } ${i % 2 === 1 ? 'md:border-l md:border-line' : ''}`}
                >
                  <div className="min-w-0">
                    <h3 className="text-[13.5px] font-semibold text-fg">{item.title}</h3>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-fg-muted">{item.body}</p>
                  </div>
                  <div className="shrink-0 text-fg-dim">{item.visual}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <div className="relative overflow-hidden rounded-[14px] border border-line-strong bg-panel px-6 py-16 text-center sm:py-20">
            <div className="ld-hero-bg absolute inset-0 opacity-70" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-fg sm:text-[40px]">
                Your footage.
                <br />
                Your motion.
                <br />
                <span className="text-fg-dim">Your control.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-md text-[13.5px] leading-relaxed text-fg-dim">
                Local, private, and precise. Open the editor and start tracking in under a minute.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <a href={HOME_URL} className="btn btn-primary h-10 px-6 text-[13.5px]">
                  <Icon name="play" size={13} /> Open Tracklet
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 sm:flex-row sm:justify-between">
        <a href="/" className="flex items-center gap-2 text-[12px] font-semibold text-fg">
          <LogoMark size={16} /> Tracklet
        </a>
        <div className="flex items-center gap-5 text-[11.5px] text-fg-dim">
          <a href="https://github.com/haveanidia/tracklet" className="transition-colors hover:text-fg">
            GitHub
          </a>
          <a href="https://github.com/haveanidia/tracklet/issues" className="transition-colors hover:text-fg">
            Issues
          </a>
          <a href="https://github.com/haveanidia/tracklet/blob/main/LICENSE" className="transition-colors hover:text-fg">
            License
          </a>
        </div>
        <span className="text-[11px] text-fg-muted">© 2026 Tracklet</span>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <div className="min-h-full bg-workspace text-fg antialiased">
      <Nav />
      <main>
        <Hero />
        <section className="relative pb-20 sm:pb-28">
          <div className="mx-auto max-w-6xl px-5">
            <Reveal>
              <Shot
                src="/assets/shots/hero-editor.png"
                alt="The Tracklet editor: the balloon tracked across 243 frames with its motion path, 95% confidence and the full timeline."
                title="balloon.webm — Tracklet"
                meta="1280×720 · 30.00 fps"
                eager
              />
            </Reveal>
          </div>
        </section>
        <Features />
        <Workflow />
        <Showcase />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
