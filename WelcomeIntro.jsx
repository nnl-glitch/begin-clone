import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

/**
 * A single animated welcome overlay: "Welcome to Begin."
 * - Words fade + rise in sequence, with the final period landing on a small
 *   accent flourish.
 * - Cursor blinks after the last word.
 * - Auto-dismisses after ~2.6s; tap anywhere or press Skip to leave early.
 * - Fully respects prefers-reduced-motion.
 */

const PHRASE = ["Welcome", "to", "Begin."];
const AUTO_DISMISS_MS = 2600;

export function WelcomeIntro({ onDone }) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);

  const dismiss = () => {
    if (!visible) return;
    setVisible(false);
    setTimeout(onDone, reduced ? 120 : 480);
  };

  useEffect(() => {
    const t = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="welcome-intro"
          className="fixed inset-0 z-[70] flex items-center justify-center px-8 cursor-pointer select-none"
          style={{ background: "var(--sc-bg-app)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.55, ease: "easeOut" }}
          onClick={dismiss}
          data-testid="welcome-intro"
          role="dialog"
          aria-label="Welcome"
        >
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            className="absolute top-6 right-6 text-xs uppercase tracking-widest opacity-60 hover:opacity-100 transition"
            style={{ color: "var(--sc-text-secondary)" }}
            data-testid="welcome-skip-btn"
            aria-label="Skip intro"
          >
            Skip
          </button>

          <div className="flex flex-col items-center gap-6 text-center">
            <motion.div
              className="flex flex-wrap items-baseline justify-center gap-x-[0.35em] gap-y-1 font-serif-reader tracking-tight"
              style={{
                color: "var(--sc-text-primary)",
                fontSize: "clamp(2.75rem, 9vw, 6rem)",
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
              }}
              data-testid="welcome-headline"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: {
                  transition: {
                    staggerChildren: reduced ? 0 : 0.28,
                    delayChildren: reduced ? 0 : 0.15,
                  },
                },
              }}
            >
              {PHRASE.map((word, i) => (
                <motion.span
                  key={i}
                  variants={{
                    hidden: { opacity: 0, y: reduced ? 0 : 18, filter: reduced ? "none" : "blur(4px)" },
                    show: {
                      opacity: 1,
                      y: 0,
                      filter: "blur(0px)",
                      transition: { duration: reduced ? 0.15 : 0.75, ease: [0.22, 1, 0.36, 1] },
                    },
                  }}
                >
                  {word}
                </motion.span>
              ))}
              {!reduced && (
                <motion.span
                  aria-hidden
                  className="inline-block ml-1"
                  style={{
                    width: "3px",
                    height: "0.85em",
                    background: "var(--sc-accent-primary)",
                    alignSelf: "center",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear", delay: 1.2 }}
                />
              )}
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0.1 : 1.35, duration: reduced ? 0.15 : 0.55 }}
              className="text-sm sm:text-base italic"
              style={{ color: "var(--sc-text-secondary)" }}
              data-testid="welcome-tagline"
            >
              a writing companion
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
