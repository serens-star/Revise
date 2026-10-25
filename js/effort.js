(function (root) {
  "use strict";
  const Revise = (root.Revise = root.Revise || {});

  const ACTIVE_WINDOW_MS = 4000;
  const PAUSE_WINDOW_MS = 20000;
  const PAUSE_WEIGHT = 0.3;
  const DELETE_BURST_MS = 1500;
  const CHARS_PER_WORD = 5;

  /**
   * @param {HTMLTextAreaElement} textarea  the writing area to watch
   * @param {object} config                 needs config.TARGET
   * @param {object} handlers               onChange(), onPasteBlocked()
   */
  Revise.createEffortTracker = function (textarea, config, handlers) {
    const target = config.TARGET;
    const state = { seconds: 0, chars: 0, revisions: 0 };
    let lastKey = 0;
    let lastDelete = 0;
    let paused = false;

    const changed = () => handlers.onChange && handlers.onChange();

    textarea.addEventListener("beforeinput", (e) => {
      const now = Date.now();
      const type = e.inputType || "";

      if (
        type === "insertFromPaste" ||
        type === "insertFromDrop" ||
        type === "insertFromYank"
      ) {
        e.preventDefault();
        handlers.onPasteBlocked && handlers.onPasteBlocked();
        return;
      }
      if (type.startsWith("insert")) {
        state.chars += e.data ? e.data.length : 1;
        lastKey = now;
      } else if (type.startsWith("delete")) {
        if (now - lastDelete > DELETE_BURST_MS) state.revisions += 1;
        lastDelete = now;
        lastKey = now;
      }
      changed();
    });

    ["paste", "drop"].forEach((name) =>
      textarea.addEventListener(name, (e) => {
        e.preventDefault();
        handlers.onPasteBlocked && handlers.onPasteBlocked();
      })
    );

    setInterval(() => {
      if (document.hidden || paused || !lastKey) return;
      const since = Date.now() - lastKey;
      if (since < ACTIVE_WINDOW_MS) state.seconds += 1;
      else if (since < PAUSE_WINDOW_MS) state.seconds += PAUSE_WEIGHT;
      changed();
    }, 1000);

    const ratio = (value, goal) => Math.min(1, value / goal);

    return {
      snapshot() {
        const words = state.chars / CHARS_PER_WORD;
        const parts = [
          ratio(state.seconds, target.seconds),
          ratio(words, target.words),
          ratio(state.revisions, target.revisions),
        ];
        return {
          values: { seconds: state.seconds, words, revisions: state.revisions },
          overall: parts.reduce((a, b) => a + b, 0) / parts.length,
          earned: parts.every((p) => p >= 1),
        };
      },

      spend(share) {
        state.seconds = Math.max(0, state.seconds - share * target.seconds);
        state.chars = Math.max(
          0,
          state.chars - share * target.words * CHARS_PER_WORD
        );
        state.revisions = Math.max(
          0,
          state.revisions - Math.ceil(share * target.revisions)
        );
      },

      setPaused(value) {
        paused = value;
      },
    };
  };
})(window);
