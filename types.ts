
export interface TimingConfig {
  t1: number; // Intro Duration
  t2: number; // Fade to Black
  t3: number; // Entry Duration
  t4: number; // Bounce Duration
  t5: number; // Overlay Fade
  t6: number; // Static / Outro
}

export interface ImageSlotData {
  url: string | null;
  xOffset: number; // 0 to 100 percentage for panning
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
}

export interface AppState {
  slots: {
    a: ImageSlotData;
    b: ImageSlotData;
    c: ImageSlotData;
    d: ImageSlotData;
  };
  timing: TimingConfig;
  typography: TypographyConfig;
  animation: AnimationConfig;
}
