"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Sparkles, Loader2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The three things an editor needs that a text box cannot do: rewrite what you
 * selected, take dictation, and accept a pasted image.
 *
 * Every one of them acts on the draft in the component above and never writes
 * to disk itself. Editing stays a thing you can abandon by pressing Escape,
 * which stops being true the moment a helper saves behind your back.
 */

type Action = { id: string; label: string; instruction: string };

/**
 * Deliberately narrow. Each rewrites the selection and returns prose — no
 * "expand", no "make it better", because an instruction that vague produces
 * text the model invented rather than a transformation of what you wrote, and
 * on a wiki that is how a note stops being true.
 */
const ACTIONS: Action[] = [
  { id: "tighten", label: "Tighten", instruction: "Rewrite this more concisely. Keep every fact. Do not add anything." },
  { id: "clarify", label: "Clarify", instruction: "Rewrite this to be clearer. Keep the meaning and every fact exactly." },
  { id: "bullets", label: "To bullets", instruction: "Rewrite this as a markdown bullet list. Keep every fact, add nothing." },
  { id: "heading", label: "Add heading", instruction: "Write a single short markdown heading line (## ...) that describes this text. Output only the heading." },
];

export function EditorTools({
  getSelection,
  replaceSelection,
  insertAtCursor,
  className,
}: {
  getSelection: () => string;
  replaceSelection: (text: string) => void;
  insertAtCursor: (text: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // The AI buttons are hidden rather than shown-and-failing when no local model
  // is running. A button that always errors is worse than no button.
  useEffect(() => {
    fetch("/api/ai")
      .then((r) => (r.ok ? r.json() : null))
      // `running` plus a usable model — Ollama being up with nothing installed
      // is the same to the user as it not being up.
      .then((d) => setAiReady(Boolean(d?.running && d?.recommended)))
      .catch(() => setAiReady(false));
  }, []);

  async function runAction(action: Action) {
    const selection = getSelection();
    if (!selection.trim()) {
      setError("Select some text first.");
      return;
    }
    setBusy(action.id);
    setError(null);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "rewrite", instruction: action.instruction, text: selection }),
      });
      const data = await response.json();
      const text = String(data.text ?? "").trim();
      if (!response.ok || !text) throw new Error(data.error ?? "The model returned nothing.");
      replaceSelection(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That failed.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Dictation via the browser's own speech recognition.
   *
   * No audio is uploaded by Lore. On Chrome the recognition itself is a Google
   * service, which is a real caveat and is why the button says what it does
   * rather than pretending to be local.
   */
  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Ctor) {
      setError("This browser has no speech recognition.");
      return;
    }

    const recognition = new Ctor() as unknown as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) insertAtCursor(`${result[0].transcript.trim()} `);
      }
    };
    recognition.onerror = () => setError("Dictation stopped.");
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setError(null);
  }

  async function upload(file: File) {
    setBusy("image");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/attachment", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload failed.");
      insertAtCursor(`\n${data.markdown}\n`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const button =
    "inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--lore-border)] px-2.5 text-[12px] font-medium text-[var(--lore-text-secondary)] transition-colors hover:bg-[var(--lore-surface-raised)] hover:text-[var(--lore-text-primary)] disabled:opacity-50";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {aiReady
        ? ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => runAction(action)}
              disabled={busy !== null}
              className={button}
            >
              {busy === action.id ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Sparkles size={11} />
              )}
              {action.label}
            </button>
          ))
        : null}

      <button
        type="button"
        onClick={toggleDictation}
        className={cn(button, listening && "border-[var(--lore-danger)] text-[var(--lore-danger)]")}
      >
        {listening ? <MicOff size={11} /> : <Mic size={11} />}
        {listening ? "Stop" : "Dictate"}
      </button>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className={button}
      >
        {busy === "image" ? <Loader2 size={11} className="animate-spin" /> : <ImageIcon size={11} />}
        Image
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />

      {error ? <span className="t-meta text-[var(--lore-danger)]">{error}</span> : null}
    </div>
  );
}
