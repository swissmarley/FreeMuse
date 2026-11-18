/**
 * Mobile voice: push-to-talk recording (expo-audio) → server transcription (Meta muse-voice-transcribe-1.0 via the API,
 * which converts to 24 kHz WAV), and on-device TTS (expo-speech) with word-boundary lip-sync.
 */
import { useCallback, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import type { VoicePref } from '@muse/core/avatar';
import { api } from './api';

export function useSpeech(pref: VoicePref, lang: string) {
  const mouth = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const speak = useCallback((text: string) => {
    Speech.stop();
    setSpeaking(true);
    const timer = setInterval(() => { mouth.current *= 0.75; }, 50);
    const done = () => { clearInterval(timer); mouth.current = 0; setSpeaking(false); };
    Speech.speak(text.replace(/[*_#`>]/g, '').slice(0, 1200), {
      language: lang, rate: pref.rate, pitch: pref.pitch, voice: pref.voiceId || undefined,
      onBoundary: () => { mouth.current = 0.9; },
      onStart: () => { mouth.current = 0.6; },
      onDone: done, onStopped: done, onError: done,
    });
  }, [pref, lang]);
  const stop = useCallback(() => { Speech.stop(); setSpeaking(false); }, []);
  return { speak, stop, speaking, mouth };
}

export function useListener(lang: string) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [listening, setListening] = useState(false);
  const start = useCallback(async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) throw new Error('Microphone permission denied');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setListening(true);
  }, [recorder]);
  const stop = useCallback(async (): Promise<string> => {
    setListening(false);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!recorder.uri) return '';
    const b64 = await new File(recorder.uri).base64();
    const { text } = await api.transcribe(b64, 'audio/m4a');
    return text;
  }, [recorder]);
  return { start, stop, listening, lang };
}
