
export interface TimingConfig {
  t1: number; // Intro Duration
  t2: number; // Fade to Black
  t3: number; // Entry Duration
  t4: number; // Bounce Duration
  tHold: number; // Hold Before Overlay
  t5: number; // Overlay Fade
  t6: number; // Static / Outro
  t7: number; // Final Fade Out
}

export interface MediaSlotData {
  url: string | null;
  type: 'image' | 'video';
  xOffset: number; // 0 to 100 percentage for panning
  aspectRatio?: number; // width / height
  startTime: number; // For videos
  endTime?: number; // For videos, defaults to duration
  duration?: number; // Total video duration
}

export interface TypographyConfig {
  content: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  fontFamily: string;
}

export interface AnimationConfig {
  bounceScale: number;
  fadeColor: 'black' | 'white';
}

export interface AppState {
  slots: {
    a: MediaSlotData;
    b: MediaSlotData;
    c: MediaSlotData;
    d: MediaSlotData;
  };
  timing: TimingConfig;
  typography: TypographyConfig;
  animation: AnimationConfig;
  quality: 'standard' | 'high';
}
