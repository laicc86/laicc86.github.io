
import { AppState } from './types';

export const INITIAL_STATE: AppState = {
  slots: {
    a: { url: 'https://picsum.photos/id/10/1920/1080', xOffset: 50 },
    b: { url: 'https://picsum.photos/id/11/1920/1080', xOffset: 20 },
    c: { url: 'https://picsum.photos/id/12/1920/1080', xOffset: 50 },
    d: { url: 'https://picsum.photos/id/13/1920/1080', xOffset: 80 },
  },
  timing: {
    t1: 2.0,
    t2: 0.5,
    t3: 0.5,
    t4: 1.5,
    t5: 1.0,
    t6: 2.5,
  },
  typography: {
    content: "MOMENTS IN MOTION\nCapturing the Essence of Light",
    fontSize: 64,
    color: "#FFFFFF",
    align: 'center',
    fontFamily: 'Inter',
  },
  animation: {
    bounceScale: 1.08,
  },
};

export const TIMING_LABELS: Record<string, string> = {
  t1: 'Intro Duration',
  t2: 'Fade to Black',
  t3: 'Entry Duration',
  t4: 'Bounce Duration',
  t5: 'Overlay Fade',
  t6: 'Static / Outro'
};

export const FONTS = [
  'Inter',
  'Playfair Display',
  'Serif',
  'Sans-Serif',
  'Monospace'
];
