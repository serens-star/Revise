(function () {
  "use strict";
  const Revise = window.Revise;
  const user = window.REVISE_CONFIG || {};

  const CFG = Object.assign(
    {
      API_KEY: "",
      PROXY_URL: "",
      MODEL: "claude-haiku-5-5",
      DELAY_MS: 12000,
      WORD_REVEAL_MS: 260,
      SPEND: 0.5,
      MIN_JUSTIFICATION_WORDS: 6,
    },
    user
  );
  CFG.TARGET = Object.assign(
    { seconds: 120, words: 60, revisions: 4 },
    user.TARGET
  );

  const $ = (id) => document.getElementById(id);
  const draft = $("draft"),
    why = $("why"),
    askBtn = $("ask");
  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let busy = false; // true while a request is in flight

  const assistant = Revise.createAssistant(CFG);
  const tracker = Revise.createEffortTracker(draft, CFG, {
    onChange: render,
    onPasteBlocked: whisperPaste,
  });

  let pasteTimer;
  function whisperPaste() {
    $("paste-note").textContent =
      "Pasted text is set aside here. The point is your own words.";
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => {
      $("paste-note").textContent = "";
    }, 6000);
  }

  const formatTime = (s) =>
    Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

  function render() {
    const snap = tracker.snapshot();
    const overall = snap.overall;

    $("effort-word").textContent = snap.earned
      ? "Ready when you are"
      : overall < 0.15
      ? "Just beginning"
      : overall < 0.4
      ? "Settling in"
      : overall < 0.7
      ? "Getting somewhere"
      : "Nearly there";

    $("fill").style.width = (overall * 100).toFixed(1) + "%";
    $("track").setAttribute("aria-valuenow", String(Math.round(overall * 100)));

    $("d-time").textContent = formatTime(
      Math.min(snap.values.seconds, CFG.TARGET.seconds)
    );
    $("d-words").textContent = Math.min(
      Math.floor(snap.values.words),
      CFG.TARGET.words
    );
    $("d-rev").textContent = Math.min(
      snap.values.revisions,
      CFG.TARGET.revisions
    );

    if (!busy) $("help").hidden = !snap.earned;
    updateAskButton();
  }

  $("t-time").textContent = formatTime(CFG.TARGET.seconds);
  $("t-words").textContent = CFG.TARGET.words;
  $("t-rev").textContent = CFG.TARGET.revisions;

  $("effort-toggle").addEventListener("click", (e) => {
    const detail = $("effort-detail");
    detail.hidden = !detail.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!detail.hidden));
  });

  const countWords = (s) => (s.trim().match(/\S+/g) || []).length;
  const chosenKind = () =>
    (document.querySelector('input[name="kind"]:checked') || {}).value;
  const kindInputs = () => document.querySelectorAll('input[name="kind"]');

  function updateAskButton() {
    const enough = countWords(why.value) >= CFG.MIN_JUSTIFICATION_WORDS;
    askBtn.disabled = busy || !chosenKind() || !enough;
    $("ask-hint").textContent = busy
      ? ""
      : !chosenKind()
      ? "Choose a kind of help."
      : !enough
      ? "A few more words of why."
      : "";
  }
  why.addEventListener("input", updateAskButton);
  kindInputs().forEach((r) => r.addEventListener("change", updateAskButton));

  if (assistant.needsKeyField()) $("key-details").hidden = false;
  $("key-input").addEventListener("input", (e) =>
    assistant.setKey(e.target.value)
  );

  const WAIT_MESSAGES = [
    "Reading what you wrote, slowly.",
    "Considering what you have not said yet.",
    "Leaving room for you.",
  ];

  async function showWaiting(durationMs) {
    const msg = $("waiting-msg");
    let i = 0;
    msg.textContent = WAIT_MESSAGES[0];
    const cycle = setInterval(() => {
      msg.classList.add("fade");
      setTimeout(() => {
        i = (i + 1) % WAIT_MESSAGES.length;
        msg.textContent = WAIT_MESSAGES[i];
        msg.classList.remove("fade");
      }, 1200);
    }, 4000);
    await sleep(durationMs);
    clearInterval(cycle);
  }

  async function reveal(text) {
    const box = $("response-text");
    box.textContent = "";
    if (prefersReducedMotion()) {
      box.textContent = text;
      return;
    }
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const span = document.createElement("span");
      span.textContent = word + " ";
      box.appendChild(span);
      await sleep(CFG.WORD_REVEAL_MS);
    }
  }

  function setFormDisabled(disabled) {
    why.disabled = disabled;
    kindInputs().forEach((r) => {
      r.disabled = disabled;
    });
  }

  askBtn.addEventListener("click", async () => {
    if (busy || askBtn.disabled) return;
    busy = true;
    tracker.setPaused(true);

    const text = draft.value,
      kind = chosenKind(),
      reason = why.value;

    setFormDisabled(true);
    askBtn.textContent = "Asking…";
    askBtn.setAttribute("aria-busy", "true");
    $("response").hidden = true;
    $("response-note").textContent = "";
    $("spent-note").textContent = "";
    $("waiting").hidden = false;

    const [result] = await Promise.all([
      assistant.ask(text, kind, reason),
      showWaiting(CFG.DELAY_MS),
    ]);

    $("waiting").hidden = true;
    $("response").hidden = false;
    $("response-sr").textContent = "";
    await reveal(result.text);
    $("response-sr").textContent = result.text;
    $("response-note").textContent = result.note;

    tracker.spend(CFG.SPEND);
    $("spent-note").textContent =
      "Some of your effort has been spent. Go back to the page. Help will return when you have earned it again.";

    why.value = "";
    kindInputs().forEach((r) => {
      r.checked = false;
    });
    setFormDisabled(false);
    askBtn.textContent = "Ask, slowly";
    askBtn.removeAttribute("aria-busy");

    busy = false;
    tracker.setPaused(false);
    render();
    draft.focus();
  });

  render();
})();
