import { ArrowRight, Car, Check, ChevronDown, Dog, Mic, Shirt, Sparkles } from "lucide-react";
import "./held-landing.css";

const services = [
  { icon: Shirt, label: "Laundry" },
  { icon: Dog, label: "Dog grooming" },
  { icon: Car, label: "Car detailing" },
  { icon: Sparkles, label: "Dry cleaning" },
];

const examples = [
  ["Laundry", "Pickup scheduled for your building’s next available window."],
  ["Tomorrow after 6 instead", "Done. Your pickup window has been moved."],
  ["Add dry cleaning too", "Added. We’ll collect both in one visit."],
];

export default function HeldLanding() {
  return (
    <div className="held-site" id="top">
      <header className="held-nav">
        <a className="held-brand" href="#top" aria-label="Held home">
          <span className="held-mark">H</span>
          <strong>Held.</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#services">Services</a>
          <a href="#difference">Why Held</a>
        </nav>
        <a className="held-login" href="/account">Resident sign in</a>
      </header>

      <main>
        <section className="held-hero">
          <div className="held-hero-copy">
            <span className="held-eyebrow">THE HOUSEHOLD CONCIERGE IN YOUR BUILDING</span>
            <h1>Pull the pen.<br /><em>Say what you need.</em></h1>
            <p className="held-lede">
              Laundry, dog grooming, car detailing, or dry cleaning—ordered in one sentence.
              No menus. No forms. No eight-click checkout.
            </p>
            <div className="held-actions">
              <a className="held-primary" href="/account">Open Held <ArrowRight /></a>
              <a className="held-secondary" href="#how">See the 10-second order <ChevronDown /></a>
            </div>
            <div className="held-command-strip" aria-label="Example voice command">
              <span><Mic /></span>
              <div><small>JUST SAY</small><strong>“Laundry tomorrow after six.”</strong></div>
              <i>Handled.</i>
            </div>
          </div>

          <div className="held-product-stage" aria-label="Held resident app preview">
            <div className="held-halo" />
            <div className="held-phone">
              <img src="/assets/held-landing/held-command-screen.png" alt="Held resident app with the pull-down fountain pen and request tray" />
            </div>
            <div className="held-pull-note"><span>1</span><b>Pull down</b><small>the fountain pen</small></div>
            <div className="held-speak-note"><span>2</span><b>Speak or type</b><small>one natural command</small></div>
            <div className="held-done-note"><Check /><b>Order placed</b><small>Your building handles the rest</small></div>
          </div>
        </section>

        <section className="held-service-ribbon" id="services">
          <p>One gesture unlocks all four</p>
          <div>{services.map(({ icon: Icon, label }) => <span key={label}><Icon /><b>{label}</b></span>)}</div>
        </section>

        <section className="held-how" id="how">
          <header>
            <span>HOW HELD WORKS</span>
            <h2>From thought to handled<br />in one command.</h2>
            <p>Held understands the request, chooses the next available building service window, and confirms it instantly.</p>
          </header>
          <div className="held-steps">
            <article><b>01</b><div className="held-mini-pen" /><h3>Pull the pen</h3><p>The physical gesture opens your private request tray.</p></article>
            <article><b>02</b><Mic /><h3>Say it normally</h3><p>“Laundry.” “Groom Milo Friday.” “Detail my car downstairs.”</p></article>
            <article><b>03</b><Check /><h3>It’s already handled</h3><p>Held enrolls you in the best available window and confirms the order.</p></article>
          </div>
        </section>

        <section className="held-conversation" id="difference">
          <div>
            <span className="held-eyebrow">NO WORKFLOW TO LEARN</span>
            <h2>Change your mind<br />the same way you made it.</h2>
            <p>If the automatic pickup window doesn’t work, just tell Held what does. It feels less like filling out a form and more like texting someone who already knows your building.</p>
            <ul>
              <li><Check /> No service menus to navigate</li>
              <li><Check /> No dates and time slots before you can order</li>
              <li><Check /> No support ticket to change a request</li>
            </ul>
          </div>
          <div className="held-chat-demo">
            {examples.map(([command, reply], index) => (
              <div className="held-chat-pair" key={command}>
                <p><small>{index === 0 ? "YOU TYPE OR SAY" : "YOU"}</small>{command}</p>
                <p><small>HELD</small>{reply}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="held-final">
          <span className="held-mark">H</span>
          <h2>Your building can do more.<br /><em>You barely have to ask.</em></h2>
          <a className="held-primary" href="/account">Open Held <ArrowRight /></a>
        </section>
      </main>

      <footer><a className="held-brand" href="#top"><span className="held-mark">H</span><strong>Held.</strong></a><p>Everyday services, coordinated through your building.</p><span>© 2026 BLDG.chat</span></footer>
    </div>
  );
}
