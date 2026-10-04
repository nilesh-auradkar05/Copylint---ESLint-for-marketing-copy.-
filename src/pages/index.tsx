/* Design Direction: Proof desk. An editor's paper-and-ink marking pass.
 * The launch-thread comparison is the visual: precise copy, visible correction,
 * and a docs path. Serif headlines, mono excerpts, hairlines; no decoration.
 */
import { Badge } from '@/components/ui/Badge'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function Landing() {
  return <>
    <Seo {...seo} path="/" />
    <div className="proof-landing" data-testid="static-landing">
      <header className="proof-row" data-testid="app-navigation">
        <a className="proof-wordmark" href="/">CopyLint<span> / proof desk</span></a>
        <a className="proof-link" data-testid="nav-sign-in-button" href="/settings">Sign in →</a>
      </header>
      <main>
        <section className="proof-hero">
          <div><p className="proof-kicker">For developer marketing</p>
            <h1>Every claim needs a source.</h1>
            <p className="proof-intro">Check technical copy against curated DeepSpace docs. Keep the evidence beside the words, and ask an engineer to settle what remains.</p>
            <a href="/settings" className="proof-cta">Sign in to CopyLint →</a>
            <p className="proof-muted">Draft. Check. Review. Then publish.</p>
          </div>
          <article className="proof-sheet" aria-label="Illustrative launch thread correction">
            <p className="proof-kicker">An example marking pass / launch thread</p>
            <h2>A small edit. A different promise.</h2>
            <div className="proof-markup"><p className="proof-kicker">Before</p>
              <blockquote><del>Paid APIs are auth-gated for you</del>, so anonymous visitors can't run up your bill.</blockquote>
              <Badge className="proof-verdict proof-contradicted">✕ Contradicted</Badge>
            </div>
            <div className="proof-markup"><p className="proof-kicker">After / suggested correction</p>
              <blockquote>Protect paid API routes with authentication, server-side role checks, and per-user quotas.</blockquote>
              <Badge className="proof-verdict proof-supported">✓ Supported</Badge>
            </div>
            <a className="proof-source" href="https://docs.deep.space/guides/external-apis">Source · guides/external-apis ↗</a>
            <p className="proof-muted">Illustration only. Draft checks use the selected docs version.</p>
          </article>
        </section>
        <section className="proof-note"><h2>Leave a trail an engineer can follow.</h2>
          <p>Atomic claims, cited excerpts, and a recorded review. Content that ships can be checked again when its cited docs change.</p>
          <Badge className="proof-verdict proof-unsupported">? Unsupported · needs judgment</Badge>
        </section>
      </main>
      <footer className="proof-muted">CopyLint · Technical claims, with receipts.</footer>
    </div>
  </>
}
