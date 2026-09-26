/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import "./joystick-landing.css";

const START_PATH = "/dayforge-onboarding";

export default function JoystickLanding() {
  return (
    <main className="joystick-landing">
      <div
        className="joystick-desktop"
        aria-label="Joystick — Play the work you hate"
      >
        <img
          className="joystick-desktop__art"
          src="/joystick/joystick-landing.png"
          alt="Joystick turns sales, follow-ups, and business administration into an adventure game."
        />

        <nav className="joystick-desktop__nav" aria-label="Joystick navigation">
          <a href="#how-it-works" aria-label="How it works" />
          <a href="#industries" aria-label="Industries" />
          <a href="#examples" aria-label="Examples" />
        </nav>

        <a
          className="joystick-desktop__cta joystick-desktop__cta--header"
          href={START_PATH}
        >
          <span className="sr-only">Start playing</span>
        </a>
        <a
          className="joystick-desktop__cta joystick-desktop__cta--hero"
          href={START_PATH}
        >
          <span className="sr-only">Start playing</span>
        </a>
      </div>

      <section className="joystick-mobile">
        <header className="joystick-mobile__header">
          <div className="joystick-mobile__brand">
            <span className="joystick-mobile__compass" aria-hidden="true">
              ✦
            </span>
            JOYSTICK
          </div>
          <a className="joystick-mobile__mini-cta" href={START_PATH}>
            START
          </a>
        </header>

        <div className="joystick-mobile__copy">
          <p className="joystick-mobile__eyebrow">
            REAL BUSINESS · REAL PROGRESS · REAL ADVENTURE
          </p>
          <h1>
            PLAY THE
            <br />
            WORK YOU HATE.
          </h1>
          <p className="joystick-mobile__lede">
            The sales, follow-ups and admin you keep avoiding become missions
            that move your actual business.
          </p>
          <a className="joystick-mobile__cta" href={START_PATH}>
            START PLAYING <span aria-hidden="true">→</span>
          </a>
          <p className="joystick-mobile__tagline">
            THE MONSTERS ARE FAKE.
            <br />
            THE MONEY ISN’T.
          </p>
        </div>

        <div className="joystick-mobile__mission" aria-hidden="true">
          <span>MISSION</span>
          <strong>CEDAR HOLLOW</strong>
          <em>FIELD INTEL READY</em>
          <ul>
            <li>Visit homeowner</li>
            <li>Learn the need</li>
            <li>Book next step</li>
          </ul>
        </div>
      </section>

      <div id="how-it-works" className="joystick-anchor" />
      <div id="industries" className="joystick-anchor" />
      <div id="examples" className="joystick-anchor" />
    </main>
  );
}
