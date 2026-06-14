import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="panel stack">
        <div className="header">
          <div>
            <h1>Construction Drawing Estimation</h1>
            <p className="muted">
              Upload construction drawing PDFs, parse them into page-aware
              markdown, and generate time and cost estimations.
            </p>
          </div>
        </div>
        <div className="stack">
          <p>
            Sign in with Google to upload PDFs, track processing status in real
            time, and review parsed and estimated markdown results.
          </p>
          <div>
            <Link className="button" href="/api/auth/google/start">
              Continue with Google
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
