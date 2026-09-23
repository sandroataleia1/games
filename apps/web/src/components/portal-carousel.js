"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./portal-carousel.module.css";
import { wrapIndex } from "../lib/carousel-index";

const AUTOPLAY_MS = 5000;

function ClockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
function TrophyIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5" />
      <path d="M12 13v3M9 20h6M9.5 20c0-1.6.7-2.6 2.5-2.6s2.5 1 2.5 2.6" />
    </svg>
  );
}
function FlameIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-.5-1.5-.5-1.5.8 1 1.5 2.6 1.5 4a4.5 4.5 0 0 1-9 0C7 8.5 11 7 12 2Z" />
    </svg>
  );
}
function StarIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2l2.6 6.6L22 9l-5.2 4.6L18.2 21 12 17.1 5.8 21l1.4-7.4L2 9l7.4-.4L12 2Z" />
    </svg>
  );
}
function PlayIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M7 4.5v15l13-7.5-13-7.5Z" />
    </svg>
  );
}
function ChevronIcon({ direction = "left", ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

// Every slide's illustration is decorative-only mock data (a demo question,
// a made-up timer/score) - never a real quiz, never a real answer key, and
// never a claim about actual usage. See docs/ADR-007.
function QuizGroupVisual() {
  return (
    <div className={styles.illustrationCard}>
      <div className={styles.topRow}>
        <span className={styles.chip} data-tone="timer"><ClockIcon /> 00:12</span>
        <span className={styles.chip} data-tone="score">+850 pts</span>
      </div>
      <p className={styles.question}>Qual é a capital da França?</p>
      <div className={styles.options}>
        <span className={styles.option} data-tone="a" data-picked="true">Paris</span>
        <span className={styles.option} data-tone="b">Roma</span>
        <span className={styles.option} data-tone="c">Madri</span>
        <span className={styles.option} data-tone="d">Lisboa</span>
      </div>
      <div className={styles.bottomRow}>
        <div className={styles.avatars}>
          <span className={styles.avatar} data-tone="a">A</span>
          <span className={styles.avatar} data-tone="b">B</span>
          <span className={styles.avatar} data-tone="c">C</span>
        </div>
        <TrophyIcon className={styles.trophy} />
      </div>
    </div>
  );
}
function QuizSoloVisual() {
  return (
    <div className={styles.illustrationCard}>
      <div className={styles.topRow}>
        <span className={styles.chip} data-tone="timer"><ClockIcon /> 00:08</span>
        <span className={styles.chip} data-tone="score">+920 pts</span>
      </div>
      <p className={styles.question}>Qual planeta é conhecido como Planeta Vermelho?</p>
      <div className={styles.options}>
        <span className={styles.option} data-tone="a">Vênus</span>
        <span className={styles.option} data-tone="b" data-picked="true">Marte</span>
        <span className={styles.option} data-tone="c">Júpiter</span>
        <span className={styles.option} data-tone="d">Saturno</span>
      </div>
      <div className={styles.bottomRow}>
        <div className={styles.avatars}>
          <span className={styles.avatar} data-tone="b">V</span>
        </div>
        <span className={styles.streak}><FlameIcon /> 3 seguidas</span>
      </div>
    </div>
  );
}
function PlatformVisual() {
  return (
    <div className={styles.illustrationCard}>
      <div className={styles.tiles}>
        <span className={styles.tile}>Q</span>
        <span className={styles.tile} data-ghost="true">+</span>
        <span className={styles.tile} data-ghost="true">+</span>
      </div>
    </div>
  );
}
const VISUALS = { platform: PlatformVisual, "quiz-group": QuizGroupVisual, "quiz-solo": QuizSoloVisual };

function SlideIllustration({ visual }) {
  const Visual = VISUALS[visual] ?? PlatformVisual;
  return (
    <div className={styles.illustration} aria-hidden="true">
      <span className={styles.floatShape} data-shape="dot-a" />
      <span className={styles.floatShape} data-shape="dot-b" />
      <StarIcon className={styles.floatShape} data-shape="star" />
      <Visual />
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (event) => setReduced(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export function PortalCarousel({ slides }) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [pauseReasons, setPauseReasons] = useState(() => new Set());
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef(null);
  const paused = pauseReasons.size > 0;

  const pause = (reason) => setPauseReasons((current) => (current.has(reason) ? current : new Set(current).add(reason)));
  const resume = (reason) => setPauseReasons((current) => {
    if (!current.has(reason)) return current;
    const next = new Set(current);
    next.delete(reason);
    return next;
  });

  const goTo = (next) => setIndex(wrapIndex(next, count));

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleVisibility = () => (document.hidden ? pause("hidden") : resume("hidden"));
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || count <= 1) return undefined;
    const timer = setInterval(() => setIndex((current) => wrapIndex(current + 1, count)), AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused, reducedMotion, count]);

  const slide = useMemo(() => slides[index], [slides, index]);

  function handleKeyDown(event) {
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); goTo(index + 1); }
  }

  return (
    <section
      ref={rootRef}
      className={styles.carousel}
      style={{ "--accent-from": slide.accent }}
      aria-roledescription="carousel"
      aria-label="Destaques da MultyGames"
      onMouseEnter={() => pause("hover")}
      onMouseLeave={() => resume("hover")}
      onFocus={() => pause("focus")}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) resume("focus"); }}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.viewport}>
        <div
          className={styles.slideBody}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} de ${count}`}
          aria-live={paused ? "polite" : "off"}
          key={slide.id}
        >
          {slide.eyebrow && <span className={styles.eyebrow}>{slide.eyebrow}</span>}
          <h2>{slide.title}</h2>
          <p>{slide.description}</p>
          <Link className={styles.action} href={slide.actionHref}>
            <PlayIcon />
            {slide.actionLabel}
          </Link>
        </div>
        <SlideIllustration visual={slide.visual} />
      </div>

      {count > 1 && (
        <div className={styles.controls}>
          <button type="button" className={styles.navButton} aria-label="Lâmina anterior" onClick={() => goTo(index - 1)}>
            <ChevronIcon direction="left" />
          </button>
          <div className={styles.indicators} role="group" aria-label="Selecionar lâmina">
            {slides.map((item, itemIndex) => (
              <button
                type="button"
                key={item.id}
                className={styles.indicator}
                aria-current={itemIndex === index ? "true" : undefined}
                aria-label={`Ir para lâmina ${itemIndex + 1} de ${count}: ${item.title}`}
                onClick={() => goTo(itemIndex)}
              />
            ))}
          </div>
          <button type="button" className={styles.navButton} aria-label="Próxima lâmina" onClick={() => goTo(index + 1)}>
            <ChevronIcon direction="right" />
          </button>
        </div>
      )}
    </section>
  );
}
