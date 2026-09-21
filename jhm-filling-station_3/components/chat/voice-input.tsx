'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Bangla speech in, two ways.
 *
 * **First choice: the browser.** The Web Speech API with `lang="bn-BD"` is
 * instant and free and runs on the device, which matters on a forecourt with
 * one bar of signal. Most Android builds in Bangladesh have it.
 *
 * **Fallback: record and send.** Safari has no Bangla recogniser at all, and
 * some Android builds return an empty result rather than admitting they cannot
 * do it. So a failed or silent recognition falls through to a MediaRecorder
 * clip posted to `/api/chat/transcribe`.
 *
 * The fallback is not only for Safari. Recognition also fails on a noisy
 * forecourt, which is where this will actually be used, and the second path
 * gives the person somewhere to go other than the keyboard.
 */

type State = 'idle' | 'listening' | 'recording' | 'transcribing';

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceInput({
  lang,
  onText,
  onError,
}: {
  lang: 'bn' | 'en';
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [interim, setInterim] = useState('');
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const gotResult = useRef(false);

  const stopEverything = useCallback(() => {
    recognition.current?.abort();
    recognition.current = null;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    setInterim('');
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  /** Record a clip and let the server transcribe it. */
  const recordAndSend = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const mr = new MediaRecorder(stream);
      recorder.current = mr;

      mr.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };

      mr.onstop = async () => {
        for (const track of stream.getTracks()) track.stop();
        setState('transcribing');

        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 1200) {
          setState('idle');
          onError(lang === 'bn' ? 'কিছু শোনা যায়নি।' : 'I did not catch that.');
          return;
        }

        const form = new FormData();
        form.set('audio', new File([blob], 'speech.webm', { type: blob.type }));
        form.set('lang', lang);

        try {
          const response = await fetch('/api/chat/transcribe', { method: 'POST', body: form });
          const body = (await response.json()) as { text?: string; error?: string };
          setState('idle');
          if (!response.ok || !body.text?.trim()) {
            onError(
              body.error ??
                (lang === 'bn' ? 'কথা বুঝতে পারলাম না, লিখে দিন।' : 'I could not make that out — type it instead.'),
            );
            return;
          }
          onText(body.text.trim());
        } catch {
          setState('idle');
          onError(lang === 'bn' ? 'কথা পাঠানো গেল না।' : 'Could not send the recording.');
        }
      };

      mr.start();
      setState('recording');
    } catch {
      setState('idle');
      onError(
        lang === 'bn'
          ? 'মাইক্রোফোন ব্যবহারের অনুমতি নেই।'
          : 'The microphone is not available. Check the browser permission.',
      );
    }
  }, [lang, onError, onText]);

  const start = useCallback(() => {
    if (state !== 'idle') {
      // Tapping again stops it, which is what a person expects of a mic button.
      if (state === 'recording') recorder.current?.stop();
      else stopEverything();
      setState('idle');
      return;
    }

    const Ctor = recognitionCtor();
    if (!Ctor) {
      void recordAndSend();
      return;
    }

    gotResult.current = false;
    const engine = new Ctor();
    recognition.current = engine;
    engine.lang = lang === 'bn' ? 'bn-BD' : 'en-GB';
    engine.continuous = false;
    engine.interimResults = true;

    engine.onresult = (event) => {
      let text = '';
      let isFinal = false;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        text += result[0]?.transcript ?? '';
        if (result.isFinal) isFinal = true;
      }
      setInterim(text);
      if (isFinal && text.trim()) {
        gotResult.current = true;
        setInterim('');
        setState('idle');
        onText(text.trim());
      }
    };

    engine.onerror = (event) => {
      recognition.current = null;
      // `not-allowed` is a refused permission and recording would be refused
      // too; anything else is worth a second attempt down the other path.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setState('idle');
        onError(
          lang === 'bn'
            ? 'মাইক্রোফোন ব্যবহারের অনুমতি নেই।'
            : 'The microphone permission was refused.',
        );
        return;
      }
      void recordAndSend();
    };

    engine.onend = () => {
      recognition.current = null;
      // Ended without ever producing a transcript: the recogniser does not
      // really know this language, whatever it claimed. Try the server.
      if (!gotResult.current && state !== 'idle') void recordAndSend();
    };

    try {
      engine.start();
      setState('listening');
    } catch {
      void recordAndSend();
    }
  }, [lang, onError, onText, recordAndSend, state, stopEverything]);

  return { state, interim, start, stop: stopEverything };
}
