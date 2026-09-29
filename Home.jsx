import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useStudio } from "../lib/studio";

export function Home() {
  const { setActiveMode } = useStudio();
  const reduced = useReducedMotion();

  const item = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
  };

  return (
    <div
      className="flex-1 w-full flex items-center justify-center px-6 py-16"
      style={{ color: "var(--sc-text-primary)" }}
      data-testid="home"
    >
      <motion.div
        className="max-w-xl w-full text-center"
        initial={reduced ? "show" : "hidden"}
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.12 } } }}
      >
        <motion.h1
          variants={item}
          className="font-serif-reader text-4xl sm:text-6xl leading-[1.05]"
          style={{ color: "var(--sc-text-primary)" }}
          data-testid="home-title"
        >
          Write with Jupiter
        </motion.h1>
        <motion.p
          variants={item}
          className="mt-6 text-base sm:text-lg leading-relaxed"
          style={{ color: "var(--sc-text-secondary)" }}
        >
          A blank page and a willing partner. Brainstorm, draft, follow an idea wherever it wants to go.
        </motion.p>
        <motion.div variants={item} className="mt-10 flex justify-center">
          <button
            onClick={() => setActiveMode("collaborate")}
            className="px-8 py-4 rounded-full font-serif-reader text-lg transition hover:-translate-y-0.5"
            style={{
              background: "#EFE7D6",
              color: "#1A1918",
              fontWeight: 500,
              boxShadow: "0 1px 0 rgba(0,0,0,0.15)",
            }}
            data-testid="home-start-btn"
          >
            Start a conversation
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
