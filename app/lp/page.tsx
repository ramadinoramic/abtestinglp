'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface VariantConfig {
  slug: string;
  theme: {
    type: 'sports' | 'casino' | 'story';
    primaryColor: string;
    secondaryColor: string;
    ctaColor: string;
    backgroundColor: string;
  };
  content: {
    headline: string;
    subheadline: string;
    ctaText: string;
    heroImage?: string;
    features?: string[];
  };
}

const VARIANTS: Record<string, VariantConfig> = {
  'sports-athletes': {
    slug: 'sports-athletes',
    theme: {
      type: 'sports',
      primaryColor: '#3b82f6',
      secondaryColor: '#1e40af',
      ctaColor: '#84cc16',
      backgroundColor: '#0f172a',
    },
    content: {
      headline: 'Hier wettet die Schweiz.',
      subheadline: '200% bis zu 400 CHF + 100 CHF FREIWETTEN',
      ctaText: 'JETZT STARTEN',
      features: ['1. Konto erstellen', '2. Einzahlen', '3. Wetten'],
    },
  },
  'casino-excitement': {
    slug: 'casino-excitement',
    theme: {
      type: 'casino',
      primaryColor: '#dc2626',
      secondaryColor: '#991b1b',
      ctaColor: '#10b981',
      backgroundColor: '#1a1a1a',
    },
    content: {
      headline: 'Dein Glück wartet.',
      subheadline: '₺10,000 SPOR HOŞ GELDİN BONUS',
      ctaText: 'Şimdi Katıl',
      features: ['1. Kayıt Ol', '2. Para Yatır', '3. Kazan'],
    },
  },
};

function LandingPageContent() {
  const searchParams = useSearchParams();
  const [clickId, setClickId] = useState<string>('');
  const [variant, setVariant] = useState<VariantConfig | null>(null);

  useEffect(() => {
    const cParam = searchParams.get('c');
    const vParam = searchParams.get('v');

    if (cParam) setClickId(cParam);

    const selectedVariant =
      vParam && VARIANTS[vParam] ? VARIANTS[vParam] : VARIANTS['sports-athletes'];
    setVariant(selectedVariant);

    trackPageView(cParam || '', vParam || 'default');
  }, [searchParams]);

  const handleCTAClick = () => {
    if (!clickId) return;
    // /api/click handles CTA tracking + token-resolved offer redirect server-side
    window.location.href = `/api/click?cid=${encodeURIComponent(clickId)}`;
  };

  if (!variant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        Loading...
      </div>
    );
  }

  return variant.theme.type === 'sports' ? (
    <SportsVariant variant={variant} onCTAClick={handleCTAClick} />
  ) : (
    <CasinoVariant variant={variant} onCTAClick={handleCTAClick} />
  );
}

interface VariantProps {
  variant: VariantConfig;
  onCTAClick: () => void;
}

function SportsVariant({ variant, onCTAClick }: VariantProps) {
  const { theme, content } = variant;

  return (
    <div className="min-h-screen" style={{ backgroundColor: theme.backgroundColor }}>
      <header className="p-4 flex justify-between items-center">
        <div className="text-2xl font-bold text-white">WETTIGO</div>
        <button
          style={{ backgroundColor: theme.ctaColor }}
          className="px-6 py-2 rounded font-semibold text-black hover:opacity-90"
        >
          REGISTRIEREN
        </button>
      </header>

      <main className="container mx-auto px-4 py-16 text-center">
        <div className="mb-8">
          <div className="w-full max-w-3xl mx-auto aspect-video bg-gradient-to-br from-blue-900 to-indigo-900 rounded-lg flex items-center justify-center">
            <div className="text-white text-6xl">🏀 ⚽ 🎾</div>
          </div>
        </div>

        <div className="inline-block px-4 py-2 bg-gray-800 text-gray-300 rounded-full text-sm mb-6">
          SCHWEIZER ORIGINAL
        </div>

        <h1 className="text-5xl md:text-6xl font-bold mb-4 text-white">{content.headline}</h1>

        <div className="mb-8">
          <p className="text-3xl font-bold mb-2" style={{ color: theme.primaryColor }}>
            200% <span className="text-white">bis zu 400 CHF</span>
          </p>
          <p className="text-xl" style={{ color: theme.ctaColor }}>
            {content.subheadline}
          </p>
        </div>

        <button
          onClick={onCTAClick}
          style={{ backgroundColor: theme.ctaColor }}
          className="w-full max-w-md mx-auto py-4 px-8 rounded-lg text-xl font-bold text-black hover:opacity-90 transition-opacity shadow-lg mb-8 block"
        >
          {content.ctaText}
        </button>

        <div className="flex justify-center gap-8 mt-12">
          {content.features?.map((feature, index) => (
            <div key={index} className="flex flex-col items-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                style={{ backgroundColor: theme.ctaColor }}
              >
                <span className="text-black font-bold">{index + 1}</span>
              </div>
              <p className="text-white text-sm">{feature.split('. ')[1]}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function CasinoVariant({ variant, onCTAClick }: VariantProps) {
  const { theme, content } = variant;

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(circle at top, ${theme.primaryColor}40, ${theme.backgroundColor})`,
      }}
    >
      <header className="p-4 text-center">
        <div className="text-3xl font-bold text-white">youwin</div>
      </header>

      <main className="container mx-auto px-4 py-8 text-center">
        <div className="mb-8">
          <div className="w-full max-w-2xl mx-auto aspect-[4/3] bg-gradient-to-br from-red-900/50 to-transparent rounded-lg flex items-center justify-center">
            <div className="text-white text-6xl">🎰 💎 🎲</div>
          </div>
        </div>

        <div className="mb-6">
          <h1 className="text-6xl md:text-7xl font-black text-white mb-2">₺10000</h1>
          <div
            className="inline-block px-6 py-2 rounded-lg text-white font-bold text-lg"
            style={{ backgroundColor: theme.primaryColor }}
          >
            SPOR HOŞ GELDİN
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white mt-4">BONUS</h2>
          <p className="text-xl text-gray-300 mt-2">BAHİS DENEYİMİNE</p>
          <p className="text-2xl font-bold text-white mt-1">
            YOU<span style={{ color: theme.primaryColor }}>WIN</span>&apos;DE BAŞLA!
          </p>
        </div>

        <div className="flex justify-center gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-20 h-20 bg-gray-800 rounded-lg flex items-center justify-center">
              🎮
            </div>
          ))}
        </div>

        <button
          onClick={onCTAClick}
          style={{ backgroundColor: theme.ctaColor }}
          className="w-full max-w-md mx-auto py-5 px-8 rounded-xl text-2xl font-bold text-white hover:opacity-90 transition-opacity shadow-2xl mb-6 block"
        >
          {content.ctaText}
        </button>

        <p className="text-gray-400 text-sm">Sadece 2 dk sürecek</p>
      </main>
    </div>
  );
}

// ============================================
// TRACKING HELPERS
// ============================================

async function trackPageView(clickId: string, variant: string) {
  if (!clickId) return;
  try {
    await fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clickId,
        event: 'page_view',
        variant,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('Failed to track page view:', error);
  }
}

// ============================================
// PAGE EXPORT
// ============================================

export default function LandingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
          Loading...
        </div>
      }
    >
      <LandingPageContent />
    </Suspense>
  );
}
