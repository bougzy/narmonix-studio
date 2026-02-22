import Link from "next/link";
import { Music, Mic, Sliders, Download, Sparkles, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Music className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold">Harmonix Studio</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-6 py-24 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm mb-6">
            <Sparkles className="h-4 w-4" />
            AI-Powered Harmony Generation
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
            Create Beautiful
            <br />
            <span className="text-primary">Choir Harmonies</span>
            <br />
            with AI
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Record or upload your vocals, and let AI generate realistic
            Soprano, Alto, Tenor, and Bass harmonies that sound like your
            own voice. Edit, mix, and export — all in your browser.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="text-lg px-8 py-6">
                Start Creating
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="text-lg px-8 py-6">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard
            icon={<Mic className="h-8 w-8" />}
            title="Record & Upload"
            description="Record vocals directly in your browser or upload audio files. Support for WAV, MP3, OGG, and FLAC."
          />
          <FeatureCard
            icon={<Sparkles className="h-8 w-8" />}
            title="AI Harmonies"
            description="Generate four-part SATB choir harmonies using AI that clones your voice character for natural-sounding results."
          />
          <FeatureCard
            icon={<Sliders className="h-8 w-8" />}
            title="Full DAW Editor"
            description="Multi-track editor with volume, pan, EQ, reverb controls. Trim, cut, and arrange your tracks with precision."
          />
          <FeatureCard
            icon={<Layers className="h-8 w-8" />}
            title="Multi-Track Mixing"
            description="Mix unlimited tracks with professional controls. Solo, mute, and fine-tune each part of your arrangement."
          />
          <FeatureCard
            icon={<Music className="h-8 w-8" />}
            title="Music Theory Engine"
            description="AI follows proper voice leading rules — no parallel fifths, correct ranges, and harmonically rich progressions."
          />
          <FeatureCard
            icon={<Download className="h-8 w-8" />}
            title="Export Anywhere"
            description="Export your full mix, individual tracks, or stems as WAV or MP3. All processing happens right in your browser."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container mx-auto px-6 text-center text-muted-foreground text-sm">
          Harmonix Studio — AI-Powered Music Editing & Harmony Generation
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors">
      <div className="text-primary mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
