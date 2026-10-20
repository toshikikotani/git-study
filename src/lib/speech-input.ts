import { useEffect, useRef, useState } from 'react';

/**
 * 声で入力する(ブラウザの音声認識、日本語)。話し終えると onText に聞き取った文を渡す。
 * 標準化前の実装(Safari などの webkitSpeechRecognition)にも対応する。使えない端末では supported が false。
 * もとは「話して・文字で記録」の画面のやり方。いまは AI の窓口(ADR-103)で使う(その画面は AI にまとめた、ADR-127)。
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput(onText: (text: string) => void): {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
} {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (Ctor === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザAPIの対応可否は一度きりの判定
    setSupported(true);
    const recognition = new Ctor();
    recognition.lang = 'ja-JP';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const toggle = () => {
    const recognition = recognitionRef.current;
    if (recognition === null) return;
    if (listening) {
      recognition.stop();
      return;
    }
    let heard = '';
    recognition.onresult = (event) => {
      heard = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? '')
        .join('');
    };
    recognition.onend = () => {
      setListening(false);
      if (heard.trim() !== '') onTextRef.current(heard.trim());
    };
    recognition.onerror = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return { supported, listening, toggle };
}
