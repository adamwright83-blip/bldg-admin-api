import { trpc } from "@/lib/trpc";
import { useState, type FormEvent } from "react";
import "./dayforge-onboarding.css";

export default function DayforgeInvitePage() {
  const token =
    new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const accept = trpc.system.saas.acceptInvite.useMutation();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await accept.mutateAsync({ token, name, password });
    window.location.assign("/dayforge-login");
  }

  return (
    <main className="df-onboarding">
      <section className="df-onboarding__card df-onboarding__card--compact">
        <p className="df-onboarding__eyebrow">DAYFORGE TEAM INVITE</p>
        <h1>Join the mission.</h1>
        {accept.error ? (
          <p className="df-onboarding__error" role="alert">
            {accept.error.message}
          </p>
        ) : null}
        <form onSubmit={submit} className="df-onboarding__form">
          <label>
            Your name
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Create password
            <input
              type="password"
              minLength={12}
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
          </label>
          <button disabled={accept.isPending || token.length < 32}>
            Accept invite
          </button>
        </form>
      </section>
    </main>
  );
}
