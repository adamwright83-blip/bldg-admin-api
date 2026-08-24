import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, ChevronRight, Loader2, MapPin, X } from "lucide-react";
import type { Order } from "@shared/types";
import overworldUrl from "@/assets/goldline/generated/goldline-overworld.png";
import operatorUrl from "@/assets/goldline/generated/trailblazer-operator.png";
import "./goldline-overworld.css";

type Position = { x: number; y: number };

const START: Position = { x: 20, y: 87 };
const GREYSTAR_GATE: Position = { x: 48, y: 48 };
const ENTER_RADIUS = 11;

function orderName(order: Order) {
  return (
    `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
    order.address ||
    `Order #${order.id}`
  );
}

function OverworldJoystick({
  onInput,
}: {
  onInput: (x: number, y: number) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = rect.width / 2;
    let x = (event.clientX - rect.left - radius) / radius;
    let y = (event.clientY - rect.top - radius) / radius;
    const magnitude = Math.hypot(x, y);
    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }
    setKnob({ x, y });
    onInput(x, y);
  }

  function release(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    onInput(0, 0);
  }

  return (
    <div
      ref={baseRef}
      className="overworld-joystick"
      aria-label="Move Trailblazer"
      role="application"
      onPointerDown={event => {
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={event => {
        if (pointerRef.current === event.pointerId) move(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <i
        style={{
          transform: `translate(${knob.x * 27}px, ${knob.y * 27}px)`,
        }}
      />
      <span>MOVE</span>
    </div>
  );
}

export default function GoldlineOverworld({
  pickups = [],
  deliveries = [],
  isLoading = false,
  greystarActive,
  isResolvingOrder = false,
  onEnterGreystar,
  onResolveOrder,
}: {
  pickups?: Order[];
  deliveries?: Order[];
  isLoading?: boolean;
  greystarActive: boolean;
  isResolvingOrder?: boolean;
  onEnterGreystar: () => void;
  onResolveOrder: (
    orderId: number,
    status: "collected" | "delivered"
  ) => Promise<boolean>;
}) {
  const [position, setPosition] = useState(START);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const inputRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef(position);
  positionRef.current = position;
  const orderCount = pickups.length + deliveries.length;
  const gateDistance = Math.hypot(
    position.x - GREYSTAR_GATE.x,
    position.y - GREYSTAR_GATE.y
  );
  const canEnterGreystar = greystarActive && gateDistance <= ENTER_RADIUS;

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(40, now - previous) / 1000;
      previous = now;
      const { x, y } = inputRef.current;
      if (Math.hypot(x, y) > 0.04) {
        const next = {
          x: Math.min(
            94,
            Math.max(6, positionRef.current.x + x * 20 * elapsed)
          ),
          y: Math.min(
            94,
            Math.max(6, positionRef.current.y + y * 20 * elapsed)
          ),
        };
        positionRef.current = next;
        setPosition(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const pressed = new Set<string>();
    const update = () => {
      inputRef.current = {
        x:
          Number(pressed.has("arrowright") || pressed.has("d")) -
          Number(pressed.has("arrowleft") || pressed.has("a")),
        y:
          Number(pressed.has("arrowdown") || pressed.has("s")) -
          Number(pressed.has("arrowup") || pressed.has("w")),
      };
    };
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        [
          "arrowright",
          "arrowleft",
          "arrowdown",
          "arrowup",
          "w",
          "a",
          "s",
          "d",
        ].includes(key)
      ) {
        event.preventDefault();
        pressed.add(key);
        update();
      }
    };
    const up = (event: KeyboardEvent) => {
      pressed.delete(event.key.toLowerCase());
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <main className="goldline-overworld-shell">
      <section
        className="goldline-overworld"
        aria-label="Goldline global overworld"
      >
        <img
          className="goldline-overworld-art"
          src={overworldUrl}
          alt="Goldline floating-island overworld with Greystar 6 at its center"
        />
        <div className="goldline-overworld-vignette" aria-hidden="true" />

        {orderCount > 0 ? (
          <button
            className="overworld-order-count"
            onClick={() => setOrdersOpen(true)}
            aria-label={`Open today's ${orderCount} pickup and dropoff orders`}
          >
            {orderCount}
          </button>
        ) : null}

        <div
          className={`overworld-player${Math.hypot(inputRef.current.x, inputRef.current.y) > 0.04 ? " is-moving" : ""}`}
          style={{ left: `${position.x}%`, top: `${position.y}%` }}
          aria-label="Trailblazer avatar"
        >
          <img src={operatorUrl} alt="" />
        </div>

        <button
          type="button"
          className={`overworld-greystar-gate${canEnterGreystar ? " is-near" : ""}${!greystarActive ? " is-locked" : ""}`}
          onClick={() => {
            if (canEnterGreystar) onEnterGreystar();
          }}
          aria-label={
            greystarActive
              ? canEnterGreystar
                ? "Enter active Greystar 6 mission"
                : "Greystar 6 is ahead; move closer to enter"
              : "Greystar 6 is not currently available"
          }
        >
          <span>
            {greystarActive
              ? canEnterGreystar
                ? "ENTER"
                : "ACTIVE"
              : "LOCKED"}
          </span>
          <b>GREYSTAR 6</b>
          <small>
            {greystarActive
              ? canEnterGreystar
                ? "CONTINUE COLOSSEUM MISSION"
                : "WALK TO THE COLOSSEUM"
              : "MISSION UNAVAILABLE"}
          </small>
          {canEnterGreystar ? <ChevronRight /> : null}
        </button>

        <div className="overworld-compass" aria-hidden="true">
          <MapPin /> GREYSTAR 6
        </div>
        <OverworldJoystick
          onInput={(x, y) => {
            inputRef.current = { x, y };
          }}
        />

        {ordersOpen ? (
          <section
            className="overworld-orders"
            aria-label="Today's pickups and dropoffs"
          >
            <header>
              <div>
                <small>TODAY'S ROUTE</small>
                <h1>{orderCount} ORDERS</h1>
              </div>
              <button
                onClick={() => setOrdersOpen(false)}
                aria-label="Close orders"
              >
                <X />
              </button>
            </header>
            {isLoading ? (
              <div className="overworld-orders-loading">
                <Loader2 /> SYNCING ORDERS…
              </div>
            ) : (
              <div className="overworld-order-list">
                {pickups.map(order => (
                  <article key={`pickup-${order.id}`}>
                    <span className="is-pickup">PICKUP</span>
                    <div>
                      <b>{orderName(order)}</b>
                      <small>{order.pickupTimeWindow || "TIME TBD"}</small>
                      <p>{order.address || "Address unavailable"}</p>
                    </div>
                    <button
                      disabled={isResolvingOrder}
                      onClick={() => void onResolveOrder(order.id, "collected")}
                    >
                      <Check /> COLLECTED
                    </button>
                  </article>
                ))}
                {deliveries.map(order => (
                  <article key={`dropoff-${order.id}`}>
                    <span className="is-dropoff">DROPOFF</span>
                    <div>
                      <b>{orderName(order)}</b>
                      <small>{order.deliveryTimeWindow || "TIME TBD"}</small>
                      <p>{order.address || "Address unavailable"}</p>
                    </div>
                    <button
                      disabled={isResolvingOrder || !order.paid}
                      onClick={() => void onResolveOrder(order.id, "delivered")}
                    >
                      <Check /> {order.paid ? "DELIVERED" : "PAYMENT BLOCKED"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
